import { useEffect, useRef } from "react";
import { useCall } from "@/lib/calls";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { startRingback, startRingtone } from "@/lib/sound";
import { cn } from "@/lib/utils";

export function CallScreen() {
  const { phase, mode, peer, localStream, remoteStream, micMuted, cameraOff, acceptCall, rejectCall, endCall, toggleMic, toggleCamera, errorMessage } = useCall();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Ring tones
  useEffect(() => {
    if (phase === "incoming") {
      const h = startRingtone();
      return () => h.stop();
    }
    if (phase === "outgoing") {
      const h = startRingback();
      return () => h.stop();
    }
  }, [phase]);

  if (phase === "idle") return null;

  const showVideo = mode === "video" && (phase === "connected" || phase === "connecting");

  const subtitle =
    phase === "incoming" ? `Incoming ${mode} call…` :
    phase === "outgoing" ? "Calling…" :
    phase === "connecting" ? "Connecting…" :
    phase === "connected" ? "Connected" :
    phase === "ended" ? (errorMessage ?? "Call ended") :
    "";

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col animate-fade-in">
      {/* Remote video / avatar */}
      <div className="relative flex-1 overflow-hidden">
        {showVideo && !cameraOff ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover bg-black"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <Avatar className="size-32 mx-auto ring-4 ring-white/10 shadow-2xl">
                <AvatarImage src={peer?.avatar_url ?? undefined} />
                <AvatarFallback className="text-3xl bg-primary/20 text-primary-foreground">{initials(peer?.name ?? "?")}</AvatarFallback>
              </Avatar>
              <h2 className="mt-6 text-3xl font-semibold tracking-tight">{peer?.name ?? "Unknown"}</h2>
              <p className={cn(
                "mt-2 text-sm",
                phase === "connected" ? "text-emerald-400" : "text-white/70",
              )}>
                {subtitle}
              </p>
            </div>
          </div>
        )}

        {/* Header overlay when video */}
        {showVideo && (
          <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/50 to-transparent">
            <h2 className="font-semibold text-lg">{peer?.name}</h2>
            <p className="text-xs text-white/70">{subtitle}</p>
          </div>
        )}

        {/* Local preview (PiP) */}
        {mode === "video" && localStream && phase !== "ended" && (
          <div className="absolute bottom-4 right-4 w-28 h-40 md:w-40 md:h-56 rounded-2xl overflow-hidden ring-2 ring-white/20 shadow-2xl bg-black">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {cameraOff && (
              <div className="absolute inset-0 grid place-items-center bg-black/80 text-white/70 text-xs">
                <VideoOff className="size-5" />
              </div>
            )}
          </div>
        )}

        <audio ref={remoteAudioRef} autoPlay />
      </div>

      {/* Controls */}
      <div className="p-6 pb-10 bg-gradient-to-t from-black/70 to-transparent">
        {phase === "incoming" ? (
          <div className="flex items-center justify-center gap-12">
            <button
              onClick={rejectCall}
              className="size-16 rounded-full bg-red-500 hover:bg-red-600 grid place-items-center shadow-lg active:scale-95 transition"
              aria-label="Reject call"
            >
              <PhoneOff className="size-7" />
            </button>
            <button
              onClick={acceptCall}
              className="size-16 rounded-full bg-emerald-500 hover:bg-emerald-600 grid place-items-center shadow-lg active:scale-95 transition animate-pulse"
              aria-label="Accept call"
            >
              <Phone className="size-7" />
            </button>
          </div>
        ) : phase === "ended" ? (
          <div className="text-center text-sm text-white/70">{subtitle}</div>
        ) : (
          <div className="flex items-center justify-center gap-4">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={toggleMic}
              className={cn(
                "size-14 rounded-full ring-1 ring-white/20 hover:bg-white/10 text-white",
                micMuted && "bg-white text-slate-900 hover:bg-white/90",
              )}
              aria-label={micMuted ? "Unmute" : "Mute"}
            >
              {micMuted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
            </Button>
            {mode === "video" && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={toggleCamera}
                className={cn(
                  "size-14 rounded-full ring-1 ring-white/20 hover:bg-white/10 text-white",
                  cameraOff && "bg-white text-slate-900 hover:bg-white/90",
                )}
                aria-label={cameraOff ? "Camera on" : "Camera off"}
              >
                {cameraOff ? <VideoOff className="size-6" /> : <Video className="size-6" />}
              </Button>
            )}
            <button
              onClick={endCall}
              className="size-16 rounded-full bg-red-500 hover:bg-red-600 grid place-items-center shadow-lg active:scale-95 transition"
              aria-label="End call"
            >
              <PhoneOff className="size-7" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
