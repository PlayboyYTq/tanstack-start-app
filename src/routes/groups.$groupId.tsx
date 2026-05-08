import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTime, initials } from "@/lib/format";
import { Send, Users, Paperclip, FileText, Reply, Copy, Trash2, X, CornerDownRight, Settings as SettingsIcon, Crown, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateSeparatorLabel, isSameDay } from "@/lib/dateLabel";
import { MobileBack } from "./chats";
import { toast } from "sonner";
import { uploadAttachment } from "@/lib/uploadAttachment";
import { GroupSettingsDialog, type GroupSettingsValue } from "@/components/GroupSettingsDialog";
import { sendPushToMany } from "@/lib/sendPush";

export const Route = createFileRoute("/groups/$groupId")({
  component: GroupChatView,
});

type Message = {
  id: string;
  group_id: string | null;
  conversation_id: string | null;
  sender_id: string;
  content: string;
  status: string;
  created_at: string;
  reply_to_message_id: string | null;
  deleted_for_everyone: boolean;
  media_url: string | null;
  media_type: string | null;
};

type Reaction = { id: string; message_id: string; user_id: string; emoji: string };
type Group = GroupSettingsValue;
type Member = { id: string; name: string; avatar_url: string | null; role: "owner" | "admin" | "member" };

const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

function mergeMessages(current: Message[], incoming: Message[]) {
  const next = [...current];
  for (const message of incoming) {
    const i = next.findIndex((x) => x.id === message.id);
    if (i !== -1) { next[i] = message; continue; }
    const opt = next.findIndex(
      (x) => x.id.startsWith("temp-") && x.sender_id === message.sender_id && x.content === message.content,
    );
    if (opt !== -1) { next[opt] = message; continue; }
    next.push(message);
  }
  return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function GroupChatView() {
  const { groupId } = useParams({ from: "/groups/$groupId" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [channelVersion, setChannelVersion] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  // Load group + members + messages + reactions + deletions
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: g }, { data: ms }, { data: mems }] = await Promise.all([
        supabase.from("groups").select("id,name,avatar_url,who_can_send,who_can_edit_info,who_can_add_members").eq("id", groupId).maybeSingle(),
        supabase.from("messages").select("*").eq("group_id", groupId).order("created_at", { ascending: true }).limit(500),
        supabase.from("group_members").select("user_id,role").eq("group_id", groupId),
      ]);
      if (cancelled) return;
      if (!g) { toast.error("Group not found"); navigate({ to: "/chats" }); return; }
      setGroup(g as Group);
      const list = (ms ?? []) as Message[];
      setMessages(list);

      const memberIds = (mems ?? []).map((m) => m.user_id);
      const roleMap = new Map((mems ?? []).map((m) => [m.user_id, m.role as Member["role"]]));
      if (memberIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,name,avatar_url")
          .in("id", memberIds);
        if (cancelled) return;
        setMembers((profs ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          avatar_url: p.avatar_url,
          role: roleMap.get(p.id) ?? "member",
        })));
      } else {
        setMembers([]);
      }

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
    })();
    return () => { cancelled = true; };
  }, [groupId, user?.id, navigate, reloadKey]);

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
      .channel(`group:${groupId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `group_id=eq.${groupId}` }, (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => mergeMessages(prev, [m]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `group_id=eq.${groupId}` }, (payload) => {
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
        const { data } = await supabase.from("messages").select("*").eq("id", id).eq("group_id", groupId).maybeSingle();
        if (data) setMessages((prev) => mergeMessages(prev, [data as Message]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, (payload) => {
        setGroup(payload.new as Group);
      })
      .subscribe((status) => {
        if (import.meta.env.DEV) console.debug(`[rt:group ${groupId}]`, status);
        if (status === "SUBSCRIBED") {
          if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleReconnect();
        }
      });
    channelRef.current = channel;
    return () => {
      disposed = true;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [groupId, user?.id, channelVersion]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const myRole: "owner" | "admin" | "member" = memberMap.get(user?.id ?? "")?.role ?? "member";

  const canSend = useMemo(() => {
    if (!group) return false;
    if (group.who_can_send === "member") return true;
    if (group.who_can_send === "admin") return myRole === "admin" || myRole === "owner";
    return myRole === "owner";
  }, [group, myRole]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !user || sending || !canSend) return;
    setSending(true);
    setDraft("");
    const replySnapshot = replyTo;
    setReplyTo(null);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: tempId,
      group_id: groupId,
      conversation_id: null,
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
      .insert({ group_id: groupId, sender_id: user.id, content, reply_to_message_id: replySnapshot?.id ?? null })
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
      const recipients = members.filter((m) => m.id !== user.id).map((m) => m.id);
      if (recipients.length) {
        const senderName = user.user_metadata?.name ?? user.email ?? "New message";
        void sendPushToMany(recipients, {
          title: senderName,
          body: content.slice(0, 140),
          url: `/groups/${groupId}`,
          tag: `group:${groupId}`,
        });
      }
    }
    setSending(false);
  };

  const sendAttachment = async (file: File) => {
    if (!user || uploading || !canSend) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const { url, kind, filename } = await uploadAttachment(file, user.id, (p) => setUploadPct(p));
      const content = kind === "file" ? filename : "";
      const { data: inserted, error } = await supabase.from("messages").insert({
        group_id: groupId,
        sender_id: user.id,
        content,
        media_url: url,
        media_type: kind,
      }).select("id").single();
      if (error) throw error;
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
    try { await navigator.clipboard.writeText(text); toast.success("Copied"); }
    catch { toast.error("Copy failed"); }
    setActiveMessageId(null);
  };

  const startReply = (m: Message) => {
    setReplyTo(m);
    setActiveMessageId(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const scrollToMessage = (id: string) => {
    const el = document.getElementById(`gmsg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    setTimeout(() => setHighlightId((c) => (c === id ? null : c)), 1500);
  };

  const visibleMessages = useMemo(() => messages.filter((m) => !hiddenIds.has(m.id)), [messages, hiddenIds]);

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 border-b border-border px-3 md:px-5 flex items-center gap-3 bg-card/50 backdrop-blur">
        <MobileBack />
        <div className="size-10 rounded-full bg-primary/10 text-primary grid place-items-center">
          <Users className="size-5" />
        </div>
        <button type="button" onClick={() => setSettingsOpen(true)} className="min-w-0 flex-1 text-left">
          <div className="font-semibold truncate flex items-center gap-1.5">
            {group?.name ?? "Group"}
            {myRole === "owner" && <Crown className="size-3.5 text-amber-500" aria-label="Owner" />}
            {myRole === "admin" && <Shield className="size-3.5 text-primary" aria-label="Admin" />}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {members.length} member{members.length === 1 ? "" : "s"} · tap for info
          </div>
        </button>
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setSettingsOpen(true)} aria-label="Group settings">
          <SettingsIcon className="size-5" />
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-2 bg-gradient-to-b from-background to-accent/20">
        {visibleMessages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-10">No messages yet — start the conversation!</div>
        )}
        {visibleMessages.map((m, i) => {
          const mine = m.sender_id === user?.id;
          const prev = visibleMessages[i - 1];
          const groupedWithPrev = prev && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 60_000;
          const showDateSeparator = !prev || !isSameDay(prev.created_at, m.created_at);
          const sender = memberMap.get(m.sender_id);
          const msgReactions = reactions.filter((r) => r.message_id === m.id);
          const reactionGroups = msgReactions.reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
            const cur = acc[r.emoji] ?? { count: 0, mine: false };
            cur.count++;
            if (r.user_id === user?.id) cur.mine = true;
            acc[r.emoji] = cur;
            return acc;
          }, {});
          const replied = m.reply_to_message_id ? messages.find((x) => x.id === m.reply_to_message_id) : null;
          const repliedSender = replied ? memberMap.get(replied.sender_id) : null;
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
                id={`gmsg-${m.id}`}
                className={cn(
                  "flex animate-fade-in transition-colors rounded-2xl",
                  mine ? "justify-end" : "justify-start",
                  groupedWithPrev ? "mt-0.5" : "mt-2",
                  highlightId === m.id && "bg-primary/10",
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
                        mine ? "bg-bubble-out text-bubble-out-foreground rounded-br-md" : "bg-bubble-in text-bubble-in-foreground rounded-bl-md",
                        isOpen && "ring-2 ring-primary/40",
                      )}
                    >
                      {!mine && !groupedWithPrev && (
                        <div className="text-xs font-semibold text-primary mb-0.5">{sender?.name ?? "Member"}</div>
                      )}
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
                            {replied.sender_id === user?.id ? "You" : repliedSender?.name ?? "Member"}
                          </div>
                          <div className="opacity-80 truncate">{replied.deleted_for_everyone ? "Message deleted" : (replied.content || (replied.media_type ? `[${replied.media_type}]` : ""))}</div>
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
                          {m.content && !(m.media_url && m.media_type === "file") && (
                            <div className="whitespace-pre-wrap break-words">{m.content}</div>
                          )}
                        </>
                      )}
                      <div className={cn("text-[10px] mt-1", mine ? "text-primary-foreground/70 text-right" : "text-muted-foreground")}>
                        {formatTime(m.created_at)}
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
                      {!m.deleted_for_everyone && m.content && (
                        <button onClick={() => copyMessage(m.content)} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left">
                          <Copy className="size-4" /> Copy
                        </button>
                      )}
                      <button onClick={() => deleteForMe(m.id)} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left text-destructive">
                        <Trash2 className="size-4" /> Delete for me
                      </button>
                      {(mine || myRole === "owner" || myRole === "admin") && !m.deleted_for_everyone && (
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
        })}
      </div>

      {replyTo && (
        <div className="px-3 md:px-4 pt-2">
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-border bg-muted/40">
            <CornerDownRight className="size-4 mt-0.5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-primary">
                Replying to {replyTo.sender_id === user?.id ? "yourself" : memberMap.get(replyTo.sender_id)?.name ?? "Member"}
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
          accept="image/*,video/*,application/pdf,.doc,.docx,.txt,.zip,.csv,.xlsx,.pptx"
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
          disabled={uploading || !canSend}
          aria-label="Attach file"
        >
          <Paperclip className="size-5" />
        </Button>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={canSend ? "Message" : "Only admins can send messages"}
          className="h-11 rounded-2xl bg-muted/60 border-transparent focus-visible:bg-background"
          autoComplete="off"
          disabled={!canSend}
        />
        <Button type="submit" size="icon" className="size-11 rounded-2xl shrink-0" disabled={!draft.trim() || sending || !canSend}>
          <Send className="size-4" />
        </Button>
      </form>

      {group && (
        <GroupSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          group={group}
          myRole={myRole}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
