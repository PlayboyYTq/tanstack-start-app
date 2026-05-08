import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { notifyAlways } from "@/lib/notifications";
import { sendPush } from "@/lib/sendPush";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type CallMode = "audio" | "video";
export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "connected" | "ended";

export type Peer = { id: string; name: string; avatar_url: string | null };

type SignalPayload =
  | { type: "offer"; callId: string; from: Peer; mode: CallMode; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; callId: string; from: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; callId: string; from: string; candidate: RTCIceCandidateInit }
  | { type: "reject"; callId: string; from: string }
  | { type: "end"; callId: string; from: string };

type CallState = {
  phase: CallPhase;
  mode: CallMode;
  peer: Peer | null;
  callId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micMuted: boolean;
  cameraOff: boolean;
  errorMessage: string | null;
};

type CallCtx = CallState & {
  startCall: (peer: Peer, mode: CallMode) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
};

const Ctx = createContext<CallCtx | undefined>(undefined);

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};

function userChannelName(userId: string) {
  return `calls:user:${userId}`;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<CallState>({
    phase: "idle",
    mode: "audio",
    peer: null,
    callId: null,
    localStream: null,
    remoteStream: null,
    micMuted: false,
    cameraOff: false,
    errorMessage: null,
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const incomingOfferRef = useRef<{ sdp: RTCSessionDescriptionInit; mode: CallMode } | null>(null);
  const myChannelRef = useRef<RealtimeChannel | null>(null);
  const peerChannelRef = useRef<RealtimeChannel | null>(null);
  const peerChannelReadyRef = useRef(false);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const outgoingIceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteSetRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const incomingNotifRef = useRef<Notification | null>(null);
  const wasConnectedRef = useRef(false);
  const callRoleRef = useRef<"caller" | "callee" | null>(null);
  const callModeRef = useRef<CallMode>("audio");

  const closeIncomingNotif = useCallback(() => {
    try { incomingNotifRef.current?.close(); } catch { /* ignore */ }
    incomingNotifRef.current = null;
  }, []);

  // Insert a system message into the 1:1 conversation marking call outcome.
  const logCallEvent = useCallback(async (
    outcome: "missed" | "rejected" | "ended",
    mode: CallMode,
    role: "caller" | "callee",
    peerId: string | null,
  ) => {
    if (!user || !peerId) return;
    try {
      const a = user.id < peerId ? user.id : peerId;
      const b = user.id < peerId ? peerId : user.id;
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_a", a)
        .eq("user_b", b)
        .maybeSingle();
      if (!conv) return;
      const icon = mode === "video" ? "📹" : "📞";
      const verb = outcome === "missed"
        ? (role === "callee" ? "Missed" : "No answer —")
        : outcome === "rejected"
          ? (role === "callee" ? "Declined" : "Call declined —")
          : "Call ended —";
      const label = mode === "video" ? "video call" : "voice call";
      const content = `${icon} ${verb} ${label}`;
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        sender_id: user.id,
        content,
        status: "sent",
      });
    } catch {
      // best-effort
    }
  }, [user]);

  const cleanup = useCallback(() => {
    try {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    } catch { /* ignore */ }
    try {
      pcRef.current?.close();
    } catch { /* ignore */ }
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    pendingIceRef.current = [];
    outgoingIceQueueRef.current = [];
    remoteSetRef.current = false;
    incomingOfferRef.current = null;
    callIdRef.current = null;
    peerIdRef.current = null;
    if (peerChannelRef.current) {
      try { supabase.removeChannel(peerChannelRef.current); } catch { /* ignore */ }
      peerChannelRef.current = null;
    }
    peerChannelReadyRef.current = false;
  }, []);

  const sendToPeer = useCallback(async (payload: SignalPayload) => {
    const ch = peerChannelRef.current;
    if (!ch) return;
    try {
      await ch.send({ type: "broadcast", event: "signal", payload });
    } catch {
      // best-effort
    }
  }, []);

  const flushOutgoingIce = useCallback(async () => {
    const ch = peerChannelRef.current;
    if (!ch || !peerChannelReadyRef.current || !user || !callIdRef.current) return;
    const queue = outgoingIceQueueRef.current;
    outgoingIceQueueRef.current = [];
    for (const candidate of queue) {
      try {
        await ch.send({ type: "broadcast", event: "signal", payload: { type: "ice", callId: callIdRef.current, from: user.id, candidate } });
      } catch { /* ignore */ }
    }
  }, [user]);

  const ensurePeerChannel = useCallback((peerId: string) => {
    if (peerChannelRef.current) return peerChannelRef.current;
    const ch = supabase.channel(userChannelName(peerId), { config: { broadcast: { self: false } } });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        peerChannelReadyRef.current = true;
        void flushOutgoingIce();
      }
    });
    peerChannelRef.current = ch;
    return ch;
  }, [flushOutgoingIce]);

  const flushIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !remoteSetRef.current) return;
    const queue = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const c of queue) {
      try { await pc.addIceCandidate(c); } catch { /* ignore */ }
    }
  }, []);

  const setupPeerConnection = useCallback((mode: CallMode) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;
    const remote = new MediaStream();
    remoteStreamRef.current = remote;
    setState((s) => ({ ...s, remoteStream: remote }));

    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => {
        if (!remote.getTracks().some((existing) => existing.id === t.id)) remote.addTrack(t);
      });
      setState((s) => ({ ...s, remoteStream: remote }));
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && callIdRef.current && peerIdRef.current && user) {
        const candidate = e.candidate.toJSON();
        if (peerChannelReadyRef.current) {
          void sendToPeer({ type: "ice", callId: callIdRef.current, from: user.id, candidate });
        } else {
          outgoingIceQueueRef.current.push(candidate);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        wasConnectedRef.current = true;
        setState((s) => ({ ...s, phase: "connected" }));
      } else if (st === "failed" || st === "disconnected") {
        // Try ICE restart once; if it doesn't recover, end.
        try { pc.restartIce(); } catch { /* ignore */ }
      } else if (st === "closed") {
        setState((s) => (s.phase === "ended" ? s : { ...s, phase: "ended" }));
      }
    };

    return { pc, mode };
  }, [sendToPeer, user]);

  const acquireLocalMedia = useCallback(async (mode: CallMode) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video" ? { facingMode: "user" } : false,
    });
    localStreamRef.current = stream;
    setState((s) => ({ ...s, localStream: stream, micMuted: false, cameraOff: false }));
    return stream;
  }, []);

  // --- Outgoing ---
  const startCall = useCallback(async (peer: Peer, mode: CallMode) => {
    if (!user) return;
    if (pcRef.current) {
      // Already in a call
      return;
    }
    const callId = `${user.id}:${peer.id}:${Date.now()}`;
    callIdRef.current = callId;
    peerIdRef.current = peer.id;
    callRoleRef.current = "caller";
    callModeRef.current = mode;
    wasConnectedRef.current = false;
    setState({
      phase: "outgoing",
      mode,
      peer,
      callId,
      localStream: null,
      remoteStream: null,
      micMuted: false,
      cameraOff: false,
      errorMessage: null,
    });
    try {
      ensurePeerChannel(peer.id);
      const stream = await acquireLocalMedia(mode);
      const { pc } = setupPeerConnection(mode);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: mode === "video" });
      await pc.setLocalDescription(offer);

      // Wait briefly for peer channel to be SUBSCRIBED before sending offer.
      const start = Date.now();
      while (!peerChannelReadyRef.current && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50));
      }

      if (import.meta.env.DEV) console.debug("[call] sending offer to", peer.id, "callId=", callId);
      const callerName = user.user_metadata?.name ?? user.email ?? "Caller";
      await sendToPeer({
        type: "offer",
        callId,
        from: { id: user.id, name: callerName, avatar_url: user.user_metadata?.avatar_url ?? null },
        mode,
        sdp: offer,
      });
      // Push notification so callee's device rings even if app is closed
      void sendPush({
        userId: peer.id,
        title: `Incoming ${mode === "video" ? "video" : "voice"} call`,
        body: `${callerName} is calling…`,
        url: "/chats",
        tag: `call:${callId}`,
        requireInteraction: true,
        data: { kind: "call", callId, mode },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not start call";
      setState((s) => ({ ...s, phase: "ended", errorMessage: msg }));
      cleanup();
    }
  }, [user, ensurePeerChannel, acquireLocalMedia, setupPeerConnection, sendToPeer, cleanup]);

  // --- Incoming ---
  const acceptCall = useCallback(async () => {
    if (!user || !state.peer || !state.callId || !incomingOfferRef.current) return;
    closeIncomingNotif();
    const { sdp, mode } = incomingOfferRef.current;
    setState((s) => ({ ...s, phase: "connecting" }));
    try {
      ensurePeerChannel(state.peer.id);
      const stream = await acquireLocalMedia(mode);
      const { pc } = setupPeerConnection(mode);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription(sdp);
      remoteSetRef.current = true;
      await flushIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Wait for peer channel ready
      const start = Date.now();
      while (!peerChannelReadyRef.current && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50));
      }

      if (import.meta.env.DEV) console.debug("[call] sending answer for callId=", state.callId);
      await sendToPeer({ type: "answer", callId: state.callId, from: user.id, sdp: answer });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not accept call";
      setState((s) => ({ ...s, phase: "ended", errorMessage: msg }));
      cleanup();
    }
  }, [user, state.peer, state.callId, ensurePeerChannel, acquireLocalMedia, setupPeerConnection, flushIce, sendToPeer, cleanup, closeIncomingNotif]);

  const rejectCall = useCallback(() => {
    if (!user || !state.callId) return;
    void sendToPeer({ type: "reject", callId: state.callId, from: user.id });
    closeIncomingNotif();
    void logCallEvent("rejected", callModeRef.current, "callee", peerIdRef.current);
    setState((s) => ({ ...s, phase: "ended" }));
    cleanup();
  }, [user, state.callId, sendToPeer, cleanup, closeIncomingNotif, logCallEvent]);

  const endCall = useCallback(() => {
    if (user && state.callId) {
      void sendToPeer({ type: "end", callId: state.callId, from: user.id });
    }
    closeIncomingNotif();
    if (wasConnectedRef.current && callRoleRef.current && peerIdRef.current) {
      void logCallEvent("ended", callModeRef.current, callRoleRef.current, peerIdRef.current);
    } else if (callRoleRef.current === "caller" && peerIdRef.current) {
      // Caller hung up before connect = no answer / missed for callee
      void logCallEvent("missed", callModeRef.current, "caller", peerIdRef.current);
    }
    setState((s) => ({ ...s, phase: "ended" }));
    cleanup();
  }, [user, state.callId, sendToPeer, cleanup, closeIncomingNotif, logCallEvent]);

  const toggleMic = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !state.micMuted;
    s.getAudioTracks().forEach((t) => (t.enabled = !next));
    setState((prev) => ({ ...prev, micMuted: next }));
  }, [state.micMuted]);

  const toggleCamera = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !state.cameraOff;
    s.getVideoTracks().forEach((t) => (t.enabled = !next));
    setState((prev) => ({ ...prev, cameraOff: next }));
  }, [state.cameraOff]);

  // Listen on my own user channel for inbound signaling
  useEffect(() => {
    if (!user) return;
    let disposed = false;
    const log = (...args: unknown[]) => { if (import.meta.env.DEV) console.debug("[call]", ...args); };

    const subscribeChannel = () => {
      const ch = supabase
        .channel(userChannelName(user.id), { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "signal" }, async ({ payload }) => {
          const sig = payload as SignalPayload;
          if (!sig || disposed) return;
          log("recv", sig.type, "callId=", sig.callId);

          if (sig.type === "offer") {
            // Reject if we're busy — auto-respond with reject so caller hears "User busy"
            if (pcRef.current || state.phase === "incoming" || state.phase === "outgoing" || state.phase === "connecting" || state.phase === "connected") {
              log("BUSY → auto-rejecting offer from", sig.from.id);
              const tempCh = supabase.channel(userChannelName(sig.from.id), { config: { broadcast: { self: false } } });
              tempCh.subscribe((st) => {
                if (st !== "SUBSCRIBED") return;
                tempCh.send({ type: "broadcast", event: "signal", payload: { type: "reject", callId: sig.callId, from: user.id } })
                  .finally(() => { try { supabase.removeChannel(tempCh); } catch { /* ignore */ } });
              });
              return;
            }
            log("incoming offer from", sig.from.name, sig.mode);
            incomingOfferRef.current = { sdp: sig.sdp, mode: sig.mode };
            callIdRef.current = sig.callId;
            peerIdRef.current = sig.from.id;
            callRoleRef.current = "callee";
            callModeRef.current = sig.mode;
            wasConnectedRef.current = false;
            ensurePeerChannel(sig.from.id);
            setState({
              phase: "incoming",
              mode: sig.mode,
              peer: sig.from,
              callId: sig.callId,
              localStream: null,
              remoteStream: null,
              micMuted: false,
              cameraOff: false,
              errorMessage: null,
            });
            incomingNotifRef.current = notifyAlways({
              title: `Incoming ${sig.mode === "video" ? "video" : "voice"} call`,
              body: `${sig.from.name} is calling…`,
              icon: sig.from.avatar_url ?? "/icon-192.png",
              tag: `call:${sig.callId}`,
              requireInteraction: true,
            });
            return;
          }

          if (sig.callId !== callIdRef.current) {
            log("ignored signal — callId mismatch", sig.callId, "vs", callIdRef.current);
            return;
          }

          if (sig.type === "answer") {
            const pc = pcRef.current;
            if (!pc) return;
            try {
              log("applying remote answer");
              await pc.setRemoteDescription(sig.sdp);
              remoteSetRef.current = true;
              setState((s) => (s.phase === "outgoing" ? { ...s, phase: "connecting" } : s));
              await flushIce();
            } catch (e) {
              log("setRemoteDescription(answer) failed", e);
            }
          } else if (sig.type === "ice") {
            const pc = pcRef.current;
            if (!pc) return;
            if (!remoteSetRef.current) {
              pendingIceRef.current.push(sig.candidate);
            } else {
              try { await pc.addIceCandidate(sig.candidate); } catch (e) { log("addIceCandidate failed", e); }
            }
          } else if (sig.type === "reject" || sig.type === "end") {
            log("remote", sig.type);
            closeIncomingNotif();
            if (!wasConnectedRef.current && callRoleRef.current && peerIdRef.current) {
              const outcome = sig.type === "reject" ? "rejected" : (callRoleRef.current === "caller" ? "missed" : "ended");
              void logCallEvent(outcome as "missed" | "rejected" | "ended", callModeRef.current, callRoleRef.current, peerIdRef.current);
            } else if (wasConnectedRef.current && callRoleRef.current && peerIdRef.current) {
              void logCallEvent("ended", callModeRef.current, callRoleRef.current, peerIdRef.current);
            }
            setState((s) => ({ ...s, phase: "ended" }));
            cleanup();
          }
        })
        .subscribe((status) => {
          log("my-channel status:", status);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            // Auto-reconnect personal call channel after a short delay so we
            // never miss an incoming call.
            if (myChannelRef.current === ch) {
              try { supabase.removeChannel(ch); } catch { /* ignore */ }
              myChannelRef.current = null;
              if (!disposed) {
                setTimeout(() => { if (!disposed && !myChannelRef.current) myChannelRef.current = subscribeChannel(); }, 1000);
              }
            }
          }
        });
      return ch;
    };

    myChannelRef.current = subscribeChannel();

    return () => {
      disposed = true;
      const ch = myChannelRef.current;
      if (ch) { try { supabase.removeChannel(ch); } catch { /* ignore */ } }
      myChannelRef.current = null;
    };
  }, [user, ensurePeerChannel, flushIce, cleanup, state.phase, closeIncomingNotif, logCallEvent]);

  // Auto-clear "ended" after a beat so UI dismisses
  useEffect(() => {
    if (state.phase !== "ended") return;
    const id = window.setTimeout(() => {
      setState({
        phase: "idle",
        mode: "audio",
        peer: null,
        callId: null,
        localStream: null,
        remoteStream: null,
        micMuted: false,
        cameraOff: false,
        errorMessage: null,
      });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [state.phase]);

  return (
    <Ctx.Provider
      value={{
        ...state,
        startCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMic,
        toggleCamera,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCall() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCall must be used within CallProvider");
  return c;
}
