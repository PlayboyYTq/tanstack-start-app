import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTime, initials } from "@/lib/format";
import { Send, Check, CheckCheck, MoreVertical, ShieldOff, Phone, Video, Reply, Copy, Trash2, X, CornerDownRight, Paperclip, FileText, Forward, Search as SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateSeparatorLabel, isSameDay } from "@/lib/dateLabel";
import { MobileBack } from "./chats";
import { toast } from "sonner";
import { useCall } from "@/lib/calls";
import { ForwardDialog, type ForwardPayload } from "@/components/ForwardDialog";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { uploadAttachment } from "@/lib/uploadAttachment";
import { usePresence } from "@/lib/presence";
import { sendPush } from "@/lib/sendPush";

export const Route = createFileRoute("/chats/$conversationId")({
  component: ChatView,
});

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  status: "sent" | "delivered" | "read";
  created_at: string;
  reply_to_message_id: string | null;
  deleted_for_everyone: boolean;
  media_url: string | null;
  media_type: string | null;
};

type Reaction = { id: string; message_id: string; user_id: string; emoji: string };
type Profile = { id: string; name: string; avatar_url: string | null; status: string; last_seen: string };

const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

function mergeMessages(current: Message[], incoming: Message[]) {
  const next = [...current];
  for (const message of incoming) {
    const existingIndex = next.findIndex((item) => item.id === message.id);
    if (existingIndex !== -1) { next[existingIndex] = message; continue; }
    const optimisticIndex = next.findIndex(
      (item) => item.id.startsWith("temp-") && item.sender_id === message.sender_id && item.content === message.content,
    );
    if (optimisticIndex !== -1) { next[optimisticIndex] = message; continue; }
    next.push(message);
  }
  return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function ChatView() {
  const { conversationId } = useParams({ from: "/chats/$conversationId" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { startCall, phase: callPhase } = useCall();
  const { isOnline } = usePresence();
  const [other, setOther] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [forwardPayload, setForwardPayload] = useState<ForwardPayload | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const realtimeReadyRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const otherTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [channelVersion, setChannelVersion] = useState(0);

  const blockUser = async () => {
    if (!user || !other) return;
    setBlocking(true);
    const { error } = await supabase.from("user_blocks").insert({ blocker_id: user.id, blocked_id: other.id });
    setBlocking(false);
    if (error) return toast.error(error.message);
    toast.success(`${other.name} has been blocked`);
    setBlockOpen(false);
    navigate({ to: "/chats" });
  };

  // Load conversation, other user, messages, reactions, hidden
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: conv } = await supabase.from("conversations").select("user_a,user_b").eq("id", conversationId).maybeSingle();
      if (!conv || cancelled) return;
      const otherId = conv.user_a === user.id ? conv.user_b : conv.user_a;
      const [{ data: prof }, { data: msgs }] = await Promise.all([
        supabase.from("profiles").select("id,name,avatar_url,status,last_seen").eq("id", otherId).maybeSingle(),
        supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(500),
      ]);
      if (cancelled) return;
      setOther(prof as Profile);
      const list = (msgs ?? []) as Message[];
      setMessages(list);

      const ids = list.map((m) => m.id);
      if (ids.length) {
        const [{ data: rx }, { data: del }] = await Promise.all([
          supabase.from("message_reactions").select("*").in("message_id", ids),
          supabase.from("message_deletions").select("message_id").in("message_id", ids).eq("user_id", user.id),
        ]);
        if (cancelled) return;
        setReactions((rx ?? []) as Reaction[]);
        setHiddenIds(new Set((del ?? []).map((d) => d.message_id)));
      }

      const unread = list.filter((m) => m.sender_id !== user.id && m.status !== "read");
      if (unread.length) {
        await supabase.from("messages").update({ status: "read" }).in("id", unread.map((m) => m.id));
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId, user?.id]);

  // Realtime
  useEffect(() => {
    if (!user) return;
    let disposed = false;
    const scheduleReconnect = () => {
      if (disposed || reconnectTimerRef.current) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        setChannelVersion((v) => v + 1);
      }, 1000);
    };

    const channel = supabase
      .channel(`conv:${conversationId}`, { config: { broadcast: { self: false } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, async (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => mergeMessages(prev, [m]));
        if (m.sender_id !== user.id) {
          await supabase.from("messages").update({ status: "read" }).eq("id", m.id);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => mergeMessages(prev, [m]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
        const old = payload.old as { id?: string };
        if (!old?.id) return;
        setMessages((prev) => prev.filter((m) => m.id !== old.id));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const r = payload.new as Reaction;
          setReactions((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
        } else if (payload.eventType === "DELETE") {
          const old = payload.old as { id?: string };
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        }
      })
      .on("broadcast", { event: "message_inserted" }, async ({ payload }) => {
        const id = (payload as { id?: string })?.id;
        if (!id) return;
        const { data } = await supabase.from("messages").select("*").eq("id", id).eq("conversation_id", conversationId).maybeSingle();
        if (!data) return;
        const m = data as Message;
        setMessages((prev) => mergeMessages(prev, [m]));
        if (m.sender_id !== user.id) {
          await supabase.from("messages").update({ status: "read" }).eq("id", m.id);
        }
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.userId === user.id) return;
        setOtherTyping(true);
        if (otherTypingTimerRef.current) clearTimeout(otherTypingTimerRef.current);
        otherTypingTimerRef.current = setTimeout(() => setOtherTyping(false), 3000);
      })
      .on("broadcast", { event: "stop_typing" }, ({ payload }) => {
        if (!payload || payload.userId === user.id) return;
        setOtherTyping(false);
        if (otherTypingTimerRef.current) clearTimeout(otherTypingTimerRef.current);
      })
      .subscribe((status) => {
        if (import.meta.env.DEV) console.debug(`[rt:conv ${conversationId}]`, status);
        if (status === "SUBSCRIBED") {
          realtimeReadyRef.current = true;
          if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeReadyRef.current = false;
          scheduleReconnect();
        }
      });
    channelRef.current = channel;
    return () => {
      disposed = true;
      realtimeReadyRef.current = false;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      if (otherTypingTimerRef.current) clearTimeout(otherTypingTimerRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, user?.id, channelVersion]);

  useEffect(() => {
    if (!other?.id) return;
    const profileChannel = supabase
      .channel(`conv-profile:${conversationId}:${other.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${other.id}` }, (payload) => setOther(payload.new as Profile))
      .subscribe();
    return () => { supabase.removeChannel(profileChannel); };
  }, [conversationId, other?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, otherTyping]);

  const broadcastTyping = (event: "typing" | "stop_typing") => {
    const ch = channelRef.current;
    if (!ch || !user || !realtimeReadyRef.current) return;
    ch.send({ type: "broadcast", event, payload: { userId: user.id } }).catch(() => {});
  };

  const onDraftChange = (v: string) => {
    setDraft(v);
    if (!user) return;
    if (v.trim().length === 0) {
      broadcastTyping("stop_typing");
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      lastTypingSentRef.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTypingSentRef.current > 1500) {
      lastTypingSentRef.current = now;
      broadcastTyping("typing");
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      broadcastTyping("stop_typing");
      lastTypingSentRef.current = 0;
    }, 2000);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !user || sending) return;
    setSending(true);
    setDraft("");
    const replySnapshot = replyTo;
    setReplyTo(null);
    broadcastTyping("stop_typing");
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    lastTypingSentRef.current = 0;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      status: "sent",
      created_at: new Date().toISOString(),
      reply_to_message_id: replySnapshot?.id ?? null,
      deleted_for_everyone: false,
      media_url: null,
      media_type: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: user.id, content, reply_to_message_id: replySnapshot?.id ?? null })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      setReplyTo(replySnapshot);
    } else if (data) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? (data as Message) : m));
      });
      channelRef.current?.send({ type: "broadcast", event: "message_inserted", payload: { id: data.id } }).catch(() => {});
      if (other) {
        const senderName = user.user_metadata?.name ?? user.email ?? "New message";
        void sendPush({
          userId: other.id,
          title: senderName,
          body: content.slice(0, 140),
          url: `/chats/${conversationId}`,
          tag: `dm:${conversationId}`,
        });
      }
    }
    setSending(false);
  };

  const sendAttachment = async (file: File) => {
    if (!user || uploading) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const { url, kind, filename } = await uploadAttachment(file, user.id, (p) => setUploadPct(p));
      const content = kind === "file" ? filename : "";
      const { data: inserted, error: insErr } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content,
        media_url: url,
        media_type: kind,
      }).select("id").single();
      if (insErr) throw insErr;
      if (inserted?.id) channelRef.current?.send({ type: "broadcast", event: "message_inserted", payload: { id: inserted.id } }).catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadPct(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;
    const existing = reactions.find((r) => r.message_id === messageId && r.user_id === user.id && r.emoji === emoji);
    if (existing) {
      setReactions((prev) => prev.filter((r) => r.id !== existing.id));
      const { error } = await supabase.from("message_reactions").delete().eq("id", existing.id);
      if (error) toast.error(error.message);
    } else {
      const { data, error } = await supabase
        .from("message_reactions")
        .insert({ message_id: messageId, user_id: user.id, emoji })
        .select()
        .single();
      if (error) toast.error(error.message);
      else if (data) setReactions((prev) => (prev.some((r) => r.id === data.id) ? prev : [...prev, data as Reaction]));
    }
    setActiveMessageId(null);
  };

  const deleteForMe = async (messageId: string) => {
    if (!user) return;
    setHiddenIds((prev) => new Set(prev).add(messageId));
    const { error } = await supabase.from("message_deletions").insert({ message_id: messageId, user_id: user.id });
    if (error && !/duplicate/i.test(error.message)) toast.error(error.message);
    setActiveMessageId(null);
  };

  const deleteForEveryone = async (messageId: string) => {
    const { error } = await supabase
      .from("messages")
      .update({ deleted_for_everyone: true, content: "" })
      .eq("id", messageId);
    if (error) toast.error(error.message);
    else setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, deleted_for_everyone: true, content: "" } : m)));
    setActiveMessageId(null);
  };

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
    setActiveMessageId(null);
  };

  const startReply = (m: Message) => {
    setReplyTo(m);
    setActiveMessageId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const scrollToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1500);
  };

  const subline = useMemo(() => {
    if (otherTyping) return "typing…";
    if (!other) return "";
    if (isOnline(other.id)) return "Online";
    return other.last_seen ? `Last seen ${formatTime(other.last_seen)}` : "Offline";
  }, [otherTyping, other, isOnline]);

  const visibleMessages = useMemo(() => messages.filter((m) => !hiddenIds.has(m.id)), [messages, hiddenIds]);

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 border-b border-border px-3 md:px-5 flex items-center gap-3 bg-card/50 backdrop-blur">
        <MobileBack />
        {other && (
          <>
            <div className="relative">
              <Avatar className="size-10">
                <AvatarImage src={other.avatar_url ?? undefined} />
                <AvatarFallback>{initials(other.name)}</AvatarFallback>
              </Avatar>
              {isOnline(other.id) && <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-online ring-2 ring-card" />}
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{other.name}</div>
              <div className={cn("text-xs transition-colors", otherTyping ? "text-primary font-medium" : "text-muted-foreground")}>
                {otherTyping ? (
                  <span className="inline-flex items-center gap-1">
                    typing
                    <span className="inline-flex gap-0.5">
                      <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                      <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                      <span className="size-1 rounded-full bg-primary animate-bounce" />
                    </span>
                  </span>
                ) : subline}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" className="rounded-full" disabled={callPhase !== "idle"} onClick={() => startCall({ id: other.id, name: other.name, avatar_url: other.avatar_url }, "audio")} aria-label="Voice call">
                <Phone className="size-5" />
              </Button>
              <Button variant="ghost" size="icon" className="rounded-full" disabled={callPhase !== "idle"} onClick={() => startCall({ id: other.id, name: other.name, avatar_url: other.avatar_url }, "video")} aria-label="Video call">
                <Video className="size-5" />
              </Button>
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => { setSearchOpen((o) => !o); setSearchQuery(""); }} aria-label="Search in chat">
                <SearchIcon className="size-5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <MoreVertical className="size-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setBlockOpen(true)} className="text-destructive focus:text-destructive">
                    <ShieldOff className="size-4 mr-2" /> Block {other.name.split(" ")[0]}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </header>

      <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {other?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They won't be able to send you messages or friend requests, and you won't see each other in search.
              Your existing friendship will be removed. You can unblock them later from Profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={blocking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={blockUser} disabled={blocking} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {blocking ? "Blocking…" : "Block"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {searchOpen && (
        <div className="px-3 md:px-5 py-2 border-b border-border bg-card/40 backdrop-blur flex items-center gap-2 animate-fade-in">
          <SearchIcon className="size-4 text-muted-foreground shrink-0" />
          <Input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in this chat"
            className="h-9 rounded-xl bg-background/70 border-border/60"
          />
          <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => { setSearchOpen(false); setSearchQuery(""); }} aria-label="Close search">
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-2 chat-wallpaper">
        {visibleMessages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-10">No messages yet — say hi!</div>
        )}
        {(() => {
          const q = searchQuery.trim().toLowerCase();
          const renderList = q
            ? visibleMessages.filter((m) => !m.deleted_for_everyone && m.content.toLowerCase().includes(q))
            : visibleMessages;
          if (q && renderList.length === 0) {
            return <div className="text-center text-sm text-muted-foreground py-10">No messages match “{searchQuery}”.</div>;
          }
          return renderList.map((m, i) => {
          const mine = m.sender_id === user?.id;
          const prev = renderList[i - 1];
          const groupedWithPrev = !q && prev && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 60_000;
          const showDateSeparator = !q && (!prev || !isSameDay(prev.created_at, m.created_at));
          const msgReactions = reactions.filter((r) => r.message_id === m.id);
          const reactionGroups = msgReactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
            const cur = acc[r.emoji] ?? { count: 0, mine: false };
            cur.count++;
            if (r.user_id === user?.id) cur.mine = true;
            acc[r.emoji] = cur;
            return acc;
          }, {});
          const replied = m.reply_to_message_id ? messages.find((x) => x.id === m.reply_to_message_id) : null;
          const isOpen = activeMessageId === m.id;

          return (
            <div key={m.id}>
              {showDateSeparator && (
                <div className="flex justify-center my-3">
                  <span className="text-[11px] font-medium px-3 py-1 rounded-full bg-muted/70 text-muted-foreground shadow-sm">
                    {dateSeparatorLabel(m.created_at)}
                  </span>
                </div>
              )}
              <div
                id={`msg-${m.id}`}
                className={cn(
                  "flex animate-fade-in transition-colors rounded-2xl",
                  mine ? "justify-end" : "justify-start",
                  groupedWithPrev ? "mt-0.5" : "mt-2",
                  (highlightId === m.id || (q && m.content.toLowerCase().includes(q))) && "bg-primary/10",
                )}
              >
              <Popover open={isOpen} onOpenChange={(o) => setActiveMessageId(o ? m.id : null)}>
                <PopoverTrigger asChild>
                  <div
                    onContextMenu={(e) => {
                      if (m.deleted_for_everyone) return;
                      e.preventDefault();
                      setActiveMessageId(m.id);
                    }}
                    onTouchStart={() => {
                      if (m.deleted_for_everyone) return;
                      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = setTimeout(() => setActiveMessageId(m.id), 450);
                    }}
                    onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                    onTouchMove={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                    className={cn(
                      "max-w-[78%] md:max-w-[60%] px-3.5 py-2 rounded-2xl text-[15px] leading-relaxed shadow-sm cursor-pointer select-none",
                      mine
                        ? "bg-bubble-out text-bubble-out-foreground rounded-br-md bubble-shadow-out"
                        : "bg-bubble-in text-bubble-in-foreground rounded-bl-md bubble-shadow-in",
                      isOpen && "ring-2 ring-primary/40",
                    )}
                  >
                    {replied && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); scrollToMessage(replied.id); }}
                        className={cn(
                          "block w-full text-left mb-1.5 px-2 py-1 rounded-lg border-l-2 text-xs",
                          mine ? "border-primary-foreground/60 bg-primary-foreground/10" : "border-primary bg-primary/10",
                        )}
                      >
                        <div className="font-semibold opacity-80 truncate">
                          {replied.sender_id === user?.id ? "You" : other?.name ?? "Them"}
                        </div>
                        <div className="opacity-80 truncate">{replied.deleted_for_everyone ? "Message deleted" : replied.content}</div>
                      </button>
                    )}
                    {m.deleted_for_everyone ? (
                      <div className="italic opacity-70 inline-flex items-center gap-1">
                        <Trash2 className="size-3.5" /> This message was deleted
                      </div>
                    ) : (
                      <>
                        {m.media_url && m.media_type === "image" && (
                          <a href={m.media_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            <img src={m.media_url} alt="attachment" className="rounded-xl max-h-72 max-w-full mb-1 object-cover" loading="lazy" />
                          </a>
                        )}
                        {m.media_url && m.media_type === "video" && (
                          <video src={m.media_url} controls className="rounded-xl max-h-72 max-w-full mb-1" onClick={(e) => e.stopPropagation()} />
                        )}
                        {m.media_url && m.media_type === "file" && (
                          <a href={m.media_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={cn("flex items-center gap-2 rounded-xl px-2.5 py-2 mb-1 border", mine ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/60")}>
                            <FileText className="size-5 shrink-0" />
                            <span className="truncate text-sm">{m.content || "Document"}</span>
                          </a>
                        )}
                        {m.content && !(m.media_url && m.media_type === "file") && (() => {
                          const isCallMsg = /^(📞|📹)/.test(m.content);
                          const isMissedCall = isCallMsg && /Missed|No answer/i.test(m.content);
                          if (isCallMsg) {
                            return (
                              <div className={cn(
                                "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
                                isMissedCall
                                  ? "bg-destructive/15 text-destructive ring-1 ring-destructive/30"
                                  : mine
                                    ? "bg-primary-foreground/15 text-primary-foreground/90"
                                    : "bg-muted text-muted-foreground",
                              )}>
                                {m.content}
                              </div>
                            );
                          }
                          return <div className="whitespace-pre-wrap break-words">{m.content}</div>;
                        })()}
                      </>
                    )}
                    <div className={cn("flex items-center gap-1 mt-1 text-[10px]", mine ? "text-primary-foreground/70 justify-end" : "text-muted-foreground")}>
                      <span>{formatTime(m.created_at)}</span>
                      {mine && !m.deleted_for_everyone && (
                        m.status === "read" ? <CheckCheck className="size-3.5 text-read transition-colors" />
                        : m.status === "delivered" ? <CheckCheck className="size-3.5 transition-colors" />
                        : <Check className="size-3.5 transition-colors" />
                      )}
                    </div>
                    {Object.keys(reactionGroups).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {Object.entries(reactionGroups).map(([emoji, info]) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleReaction(m.id, emoji); }}
                            className={cn(
                              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] border transition",
                              info.mine ? "bg-primary/20 border-primary/40" : "bg-background/60 border-border hover:bg-background",
                            )}
                          >
                            <span>{emoji}</span>
                            {info.count > 1 && <span className="font-medium">{info.count}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </PopoverTrigger>
                <PopoverContent side="top" align={mine ? "end" : "start"} className="w-auto p-2 rounded-2xl">
                  <div className="flex items-center gap-1 mb-2">
                    {REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => toggleReaction(m.id, emoji)}
                        className="size-9 rounded-full hover:bg-muted text-xl transition"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="border-t pt-1 flex flex-col text-sm">
                    <button onClick={() => startReply(m)} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left">
                      <Reply className="size-4" /> Reply
                    </button>
                    {!m.deleted_for_everyone && (
                      <button
                        onClick={() => {
                          setForwardPayload({ content: m.content, media_url: m.media_url, media_type: m.media_type });
                          setActiveMessageId(null);
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left"
                      >
                        <Forward className="size-4" /> Forward
                      </button>
                    )}
                    {!m.deleted_for_everyone && m.content && (
                      <button onClick={() => copyMessage(m.content)} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left">
                        <Copy className="size-4" /> Copy
                      </button>
                    )}
                    <button onClick={() => deleteForMe(m.id)} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left text-destructive">
                      <Trash2 className="size-4" /> Delete for me
                    </button>
                    {mine && !m.deleted_for_everyone && (
                      <button onClick={() => deleteForEveryone(m.id)} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left text-destructive">
                        <Trash2 className="size-4" /> Delete for everyone
                      </button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            </div>
          );
        });
        })()}
        {otherTyping && (
          <div className="flex justify-start mt-2 animate-fade-in">
            <div className="bg-bubble-in text-bubble-in-foreground rounded-2xl rounded-bl-md px-3.5 py-2.5 shadow-sm">
              <span className="inline-flex gap-1 items-center">
                <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.3s]" />
                <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.15s]" />
                <span className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce" />
              </span>
            </div>
          </div>
        )}
      </div>

      {replyTo && (
        <div className="px-3 md:px-4 pt-2">
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-border bg-muted/40">
            <CornerDownRight className="size-4 mt-0.5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-primary">
                Replying to {replyTo.sender_id === user?.id ? "yourself" : other?.name}
              </div>
              <div className="text-sm truncate text-muted-foreground">{replyTo.deleted_for_everyone ? "Message deleted" : replyTo.content}</div>
            </div>
            <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {uploading && (
        <div className="px-4 pt-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Uploading attachment…</span>
            <span className="font-medium tabular-nums">{uploadPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-150" style={{ width: `${uploadPct}%` }} />
          </div>
        </div>
      )}
      <form onSubmit={send} className="p-3 md:p-4 border-t border-border bg-card/50 backdrop-blur flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,application/pdf,.doc,.docx,.txt,.zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendAttachment(f);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 rounded-2xl shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Attach file"
        >
          <Paperclip className="size-5" />
        </Button>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Message"
          className="h-11 rounded-2xl bg-muted/60 border-transparent focus-visible:bg-background"
          autoComplete="off"
        />
        <Button type="submit" size="icon" className="size-11 rounded-2xl shrink-0" disabled={!draft.trim() || sending}>
          <Send className="size-4" />
        </Button>
      </form>

      <ForwardDialog
        open={!!forwardPayload}
        onOpenChange={(o) => { if (!o) setForwardPayload(null); }}
        payload={forwardPayload}
      />
    </div>
  );
}
