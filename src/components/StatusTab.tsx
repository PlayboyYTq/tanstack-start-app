import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, ImagePlus, Type, X, Eye, Send, Pause, Video as VideoIcon } from "lucide-react";
import { initials } from "@/lib/format";
import { uploadAttachment, detectKind } from "@/lib/uploadAttachment";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type StatusRow = {
  id: string;
  user_id: string;
  kind: "image" | "text" | "video";
  media_url: string | null;
  content: string | null;
  background: string | null;
  created_at: string;
  expires_at: string;
};
type Profile = { id: string; name: string; avatar_url: string | null };
type Group = { user: Profile; statuses: StatusRow[]; lastAt: string };

function timeAgo(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function StatusTab() {
  const { user, profile } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [myGroup, setMyGroup] = useState<Group | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [viewer, setViewer] = useState<{ group: Group; index: number } | null>(null);

  const load = async () => {
    if (!user) return;
    const { data: rows } = await supabase
      .from("statuses")
      .select("*")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });
    const list = (rows ?? []) as StatusRow[];
    const userIds = Array.from(new Set(list.map((r) => r.user_id)));
    const { data: profs } = userIds.length
      ? await supabase.from("profiles").select("id,name,avatar_url").in("id", userIds)
      : { data: [] as Profile[] };
    const profMap = new Map((profs ?? []).map((p: Profile) => [p.id, p]));
    const grouped = new Map<string, Group>();
    for (const r of list) {
      const u = profMap.get(r.user_id) ?? { id: r.user_id, name: "Unknown", avatar_url: null };
      const g = grouped.get(r.user_id) ?? { user: u, statuses: [], lastAt: r.created_at };
      g.statuses.push(r);
      g.lastAt = r.created_at;
      grouped.set(r.user_id, g);
    }
    const all = Array.from(grouped.values()).sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));
    const mine = all.find((g) => g.user.id === user.id) ?? null;
    if (mine && profile) mine.user = { id: user.id, name: profile.name ?? "You", avatar_url: profile.avatar_url };
    setMyGroup(mine);
    setGroups(all.filter((g) => g.user.id !== user.id));
  };

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase
      .channel(`status-list:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "statuses" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* My status */}
      <button
        type="button"
        onClick={() => (myGroup ? setViewer({ group: myGroup, index: 0 }) : setComposeOpen(true))}
        className="w-full mx-2 my-1 px-3 py-3 flex items-center gap-3 rounded-2xl hover:bg-accent/60 text-left"
      >
        <div className="relative">
          <Avatar className={cn("size-12", myGroup && "ring-2 ring-primary ring-offset-2 ring-offset-sidebar")}>
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback>{initials(profile?.name ?? "U")}</AvatarFallback>
          </Avatar>
          {!myGroup && (
            <span className="absolute -bottom-0.5 -right-0.5 size-5 rounded-full bg-primary text-primary-foreground grid place-items-center ring-2 ring-sidebar">
              <Plus className="size-3" />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">My status</div>
          <div className="text-xs text-muted-foreground">
            {myGroup ? `${myGroup.statuses.length} update${myGroup.statuses.length > 1 ? "s" : ""} • ${timeAgo(myGroup.lastAt)}` : "Tap to add status update"}
          </div>
        </div>
        {myGroup && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setComposeOpen(true); }}
            className="size-9 rounded-full grid place-items-center bg-accent hover:bg-accent/80"
            aria-label="Add another status"
          >
            <Plus className="size-4" />
          </button>
        )}
      </button>

      {groups.length > 0 && (
        <div className="px-5 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent updates</div>
      )}
      {groups.map((g) => (
        <button
          key={g.user.id}
          type="button"
          onClick={() => setViewer({ group: g, index: 0 })}
          className="w-full mx-2 px-3 py-3 flex items-center gap-3 rounded-2xl hover:bg-accent/60 text-left"
        >
          <Avatar className="size-12 ring-2 ring-primary ring-offset-2 ring-offset-sidebar">
            <AvatarImage src={g.user.avatar_url ?? undefined} />
            <AvatarFallback>{initials(g.user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{g.user.name}</div>
            <div className="text-xs text-muted-foreground">{timeAgo(g.lastAt)}</div>
          </div>
        </button>
      ))}

      {groups.length === 0 && !myGroup && (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          No status updates yet.<br />Tap "My status" to share one.
        </div>
      )}

      <ComposeStatusDialog open={composeOpen} onOpenChange={setComposeOpen} onPosted={load} />
      {viewer && <StatusViewer group={viewer.group} startIndex={viewer.index} onClose={() => setViewer(null)} onChanged={load} />}
    </div>
  );
}

function ComposeStatusDialog({ open, onOpenChange, onPosted }: { open: boolean; onOpenChange: (b: boolean) => void; onPosted: () => void }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [bg, setBg] = useState("#7c3aed");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const postText = async () => {
    if (!user || !text.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("statuses").insert({ user_id: user.id, kind: "text", content: text.trim(), background: bg });
    setBusy(false);
    if (error) return toast.error(error.message);
    setText("");
    onOpenChange(false);
    onPosted();
  };

  const postMedia = async (file: File) => {
    if (!user) return;
    const kind = detectKind(file);
    if (kind !== "image" && kind !== "video") {
      toast.error("Only images and videos are supported.");
      return;
    }
    setBusy(true);
    try {
      const { url } = await uploadAttachment(file, user.id);
      const { error } = await supabase.from("statuses").insert({ user_id: user.id, kind, media_url: url });
      if (error) throw error;
      onOpenChange(false);
      onPosted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post status");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (videoRef.current) videoRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New status</DialogTitle></DialogHeader>
        <div
          className="rounded-2xl p-6 min-h-40 flex items-center justify-center text-white text-xl font-semibold text-center"
          style={{ background: bg }}
        >
          {text || "Type something…"}
        </div>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a status…" maxLength={200} />
        <div className="flex items-center gap-2">
          {["#7c3aed", "#ef4444", "#0ea5e9", "#10b981", "#f59e0b", "#111827"].map((c) => (
            <button key={c} type="button" onClick={() => setBg(c)} className="size-7 rounded-full ring-2 ring-offset-2 ring-offset-background" style={{ background: c, boxShadow: bg === c ? "0 0 0 2px var(--ring)" : undefined }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={postText} disabled={busy || !text.trim()} className="flex-1 min-w-[110px]">
            <Type className="size-4 mr-2" /> Text
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy} className="flex-1 min-w-[110px]">
            <ImagePlus className="size-4 mr-2" /> Image
          </Button>
          <Button variant="secondary" onClick={() => videoRef.current?.click()} disabled={busy} className="flex-1 min-w-[110px]">
            <VideoIcon className="size-4 mr-2" /> Video
          </Button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void postMedia(f); }} />
          <input ref={videoRef} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void postMedia(f); }} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusViewer({ group, startIndex, onClose, onChanged }: { group: Group; startIndex: number; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [idx, setIdx] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const current = group.statuses[idx];
  const isMine = current?.user_id === user?.id;

  // Reset when story changes
  useEffect(() => {
    setImgLoaded(current?.kind === "text");
  }, [current?.id]);

  // Record view
  useEffect(() => {
    if (!current || !user) return;
    if (!isMine) {
      void supabase.from("status_views").insert({ status_id: current.id, viewer_id: user.id }).then(() => {});
    } else {
      void supabase.from("status_views").select("*", { count: "exact", head: true }).eq("status_id", current.id).then(({ count }) => setViewerCount(count ?? 0));
    }
  }, [current?.id, isMine, user?.id]);

  // Smooth progress timer using rAF — pauses on hold/typing and waits for image load
  useEffect(() => {
    if (!current) return;
    setProgress(0);
    const dur = 5000;
    let raf = 0;
    let start = performance.now();
    let lastTick = start;
    const tick = (now: number) => {
      if (paused || !imgLoaded) {
        start += now - lastTick; // freeze elapsed
        lastTick = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      lastTick = now;
      const p = Math.min(100, ((now - start) / dur) * 100);
      setProgress(p);
      if (p >= 100) {
        if (idx < group.statuses.length - 1) setIdx(idx + 1);
        else onClose();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [current?.id, idx, paused, imgLoaded, group.statuses.length, onClose]);

  const remove = async () => {
    if (!current) return;
    const { error } = await supabase.from("statuses").delete().eq("id", current.id);
    if (error) return toast.error(error.message);
    toast.success("Status deleted");
    onChanged();
    onClose();
  };

  const sendReply = async () => {
    if (!user || !current || !reply.trim()) return;
    setSending(true);
    try {
      const [a, b] = [user.id, current.user_id].sort();
      let { data: existing } = await supabase
        .from("conversations").select("id").eq("user_a", a).eq("user_b", b).maybeSingle();
      let convId = existing?.id;
      if (!convId) {
        const { data: created, error: cErr } = await supabase
          .from("conversations").insert({ user_a: a, user_b: b }).select("id").single();
        if (cErr || !created) throw cErr ?? new Error("Could not start chat");
        convId = created.id;
      }
      const preview = current.kind === "image" ? "📷 Photo status" : current.kind === "video" ? "🎬 Video status" : `"${(current.content ?? "").slice(0, 40)}"`;
      const body = `↪️ Replied to your status ${preview}\n${reply.trim()}`;
      const { error: mErr } = await supabase.from("messages").insert({
        conversation_id: convId, sender_id: user.id, content: body,
      });
      if (mErr) throw mErr;
      toast.success("Reply sent");
      setReply("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 grid place-items-center animate-fade-in">
      <div className="absolute top-0 inset-x-0 p-3 flex gap-1">
        {group.statuses.map((_, i) => (
          <div key={i} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
            <div
              className="h-full bg-white"
              style={{
                width: `${i < idx ? 100 : i === idx ? progress : 0}%`,
                transition: i === idx ? "width 80ms linear" : undefined,
              }}
            />
          </div>
        ))}
      </div>
      <div className="absolute top-6 left-3 right-3 flex items-center gap-3 text-white">
        <Avatar className="size-9 ring-1 ring-white/40">
          <AvatarImage src={group.user.avatar_url ?? undefined} />
          <AvatarFallback>{initials(group.user.name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{group.user.name}</div>
          <div className="text-xs opacity-70">{timeAgo(current.created_at)}</div>
        </div>
        {isMine && viewerCount !== null && (
          <span className="inline-flex items-center gap-1 text-xs opacity-80"><Eye className="size-3.5" /> {viewerCount}</span>
        )}
        {isMine && <button onClick={remove} className="text-xs opacity-80 hover:opacity-100">Delete</button>}
        <button onClick={onClose} className="size-8 grid place-items-center rounded-full bg-white/10 hover:bg-white/20"><X className="size-4" /></button>
      </div>
      {/* Tap zones — also pause-on-hold for smooth viewing */}
      <button
        className="absolute inset-y-0 left-0 w-1/3"
        onClick={() => (idx > 0 ? setIdx(idx - 1) : null)}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
        aria-label="Previous"
      />
      <button
        className="absolute inset-y-0 right-0 w-1/3"
        onClick={() => (idx < group.statuses.length - 1 ? setIdx(idx + 1) : onClose())}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
        aria-label="Next"
      />
      {current.kind === "image" && current.media_url ? (
        <>
          {!imgLoaded && (
            <div className="absolute inset-0 grid place-items-center text-white/70 text-sm">Loading…</div>
          )}
          <img
            key={current.id}
            src={current.media_url}
            alt="status"
            onLoad={() => setImgLoaded(true)}
            className={cn(
              "max-w-full max-h-full object-contain transition-opacity duration-300",
              imgLoaded ? "opacity-100" : "opacity-0"
            )}
          />
        </>
      ) : current.kind === "video" && current.media_url ? (
        <video
          key={current.id}
          src={current.media_url}
          autoPlay
          playsInline
          controls
          onLoadedData={() => setImgLoaded(true)}
          onEnded={() => { if (idx < group.statuses.length - 1) setIdx(idx + 1); else onClose(); }}
          className="max-w-full max-h-full object-contain"
        />
      ) : (
        <div
          key={current.id}
          className="max-w-md w-full mx-6 aspect-square rounded-2xl flex items-center justify-center text-white text-2xl font-semibold p-8 text-center animate-fade-in"
          style={{ background: current.background ?? "#7c3aed" }}
        >
          {current.content}
        </div>
      )}
      {/* Reply bar — only for others' statuses */}
      {!isMine && (
        <div className="absolute bottom-0 inset-x-0 p-3 z-10 bg-gradient-to-t from-black/70 to-transparent">
          <form
            onSubmit={(e) => { e.preventDefault(); void sendReply(); }}
            className="mx-auto max-w-md flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/20 px-3 py-2"
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              placeholder={`Reply to ${group.user.name.split(" ")[0]}…`}
              maxLength={500}
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/60"
            />
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="size-8 grid place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
              aria-label="Send reply"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}
      {paused && !isMine && (
        <span className="sr-only"><Pause className="size-3" /> paused</span>
      )}
    </div>
  );
}