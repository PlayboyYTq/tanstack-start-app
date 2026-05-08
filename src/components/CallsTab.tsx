import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useCall } from "@/lib/calls";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed, MoreVertical, Trash2 } from "lucide-react";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type CallRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};
type Profile = { id: string; name: string; avatar_url: string | null };
type Conv = { id: string; user_a: string; user_b: string };

type CallEntry = {
  id: string;
  peer: Profile;
  conversationId: string;
  mode: "audio" | "video";
  direction: "incoming" | "outgoing";
  outcome: "missed" | "rejected" | "ended";
  at: string;
};

function parseCallContent(content: string): { mode: "audio" | "video"; outcome: "missed" | "rejected" | "ended" } | null {
  const isVideo = /video call/i.test(content);
  const mode: "audio" | "video" = isVideo ? "video" : "audio";
  if (/Missed|No answer/i.test(content)) return { mode, outcome: "missed" };
  if (/Declined|declined/i.test(content)) return { mode, outcome: "rejected" };
  if (/Call ended/i.test(content)) return { mode, outcome: "ended" };
  return null;
}

function shortTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

export function CallsTab() {
  const { user } = useAuth();
  const { startCall } = useCall();
  const [entries, setEntries] = useState<CallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data: convs } = await supabase
      .from("conversations")
      .select("id,user_a,user_b")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
    const convList = (convs ?? []) as Conv[];
    if (!convList.length) { setEntries([]); setLoading(false); return; }
    const convIds = convList.map((c) => c.id);
    const otherIds = Array.from(new Set(convList.map((c) => (c.user_a === user.id ? c.user_b : c.user_a))));

    const [{ data: msgs }, { data: profs }, { data: hidden }] = await Promise.all([
      supabase
        .from("messages")
        .select("id,conversation_id,sender_id,content,created_at")
        .in("conversation_id", convIds)
        .or("content.ilike.📞%,content.ilike.📹%")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("profiles").select("id,name,avatar_url").in("id", otherIds),
      supabase.from("message_deletions").select("message_id").eq("user_id", user.id),
    ]);
    const profMap = new Map(((profs ?? []) as Profile[]).map((p) => [p.id, p]));
    const convMap = new Map(convList.map((c) => [c.id, c]));
    const hiddenSet = new Set(((hidden ?? []) as { message_id: string }[]).map((h) => h.message_id));
    const out: CallEntry[] = [];
    for (const m of (msgs ?? []) as CallRow[]) {
      if (hiddenSet.has(m.id)) continue;
      const parsed = parseCallContent(m.content);
      if (!parsed) continue;
      const conv = convMap.get(m.conversation_id);
      if (!conv) continue;
      const peerId = conv.user_a === user.id ? conv.user_b : conv.user_a;
      const peer = profMap.get(peerId) ?? { id: peerId, name: "Unknown", avatar_url: null };
      out.push({
        id: m.id,
        peer,
        conversationId: m.conversation_id,
        mode: parsed.mode,
        outcome: parsed.outcome,
        direction: m.sender_id === user.id ? "outgoing" : "incoming",
        at: m.created_at,
      });
    }
    setEntries(out);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase
      .channel(`calls-tab:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const deleteEntry = async (entry: CallEntry) => {
    if (!user) return;
    // If sender, hard-delete the message; else hide it for this user.
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    if (entry.direction === "outgoing") {
      const { error } = await supabase.from("messages").delete().eq("id", entry.id);
      if (error) { toast.error("Couldn't delete"); void load(); return; }
    } else {
      const { error } = await supabase.from("message_deletions").insert({ message_id: entry.id, user_id: user.id });
      if (error) { toast.error("Couldn't delete"); void load(); return; }
    }
    toast.success("Call removed");
  };

  const clearAll = async () => {
    if (!user || entries.length === 0) return;
    const owned = entries.filter((e) => e.direction === "outgoing").map((e) => e.id);
    const other = entries.filter((e) => e.direction === "incoming").map((e) => e.id);
    setEntries([]);
    setConfirmClear(false);
    try {
      if (owned.length) await supabase.from("messages").delete().in("id", owned);
      if (other.length) {
        await supabase.from("message_deletions").insert(other.map((id) => ({ message_id: id, user_id: user.id })));
      }
      toast.success("Call history cleared");
    } catch {
      toast.error("Couldn't clear all");
      void load();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {entries.length > 0 && (
        <div className="flex items-center justify-between px-5 py-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent calls</div>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
          >
            <Trash2 className="size-3.5" /> Clear all
          </button>
        </div>
      )}
      {loading && <div className="px-6 py-8 text-sm text-muted-foreground text-center">Loading…</div>}
      {!loading && entries.length === 0 && (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
          No call history yet.<br />Start a voice or video call from any chat.
        </div>
      )}
      {entries.map((e) => {
        const isMissed = e.outcome === "missed" && e.direction === "incoming";
        const Icon = isMissed ? PhoneMissed : e.direction === "outgoing" ? PhoneOutgoing : PhoneIncoming;
        return (
          <div
            key={e.id}
            className={cn(
              "mx-2 px-3 py-3 rounded-2xl flex items-center gap-3 hover:bg-accent/60",
              isMissed && "bg-destructive/5 ring-1 ring-destructive/15",
            )}
          >
            <Avatar className="size-12">
              <AvatarImage src={e.peer.avatar_url ?? undefined} />
              <AvatarFallback>{initials(e.peer.name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className={cn("font-medium truncate flex items-center gap-2", isMissed && "text-destructive")}>
                {e.peer.name}
                {isMissed && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive">
                    Missed
                  </span>
                )}
              </div>
              <div className={cn("text-xs inline-flex items-center gap-1", isMissed ? "text-destructive/80" : "text-muted-foreground")}>
                <Icon className={cn("size-3.5", isMissed ? "text-destructive" : "text-muted-foreground")} />
                <span className="capitalize">{e.outcome === "ended" ? e.direction : e.outcome}</span>
                <span>•</span>
                <span>{shortTime(e.at)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => startCall({ id: e.peer.id, name: e.peer.name, avatar_url: e.peer.avatar_url }, e.mode)}
              className="size-9 rounded-full grid place-items-center text-primary hover:bg-primary/10"
              aria-label={`Call ${e.peer.name}`}
            >
              {e.mode === "video" ? <Video className="size-4" /> : <Phone className="size-4" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="size-8 rounded-full grid place-items-center text-muted-foreground hover:bg-accent"
                  aria-label="More options"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => deleteEntry(e)} className="text-destructive focus:text-destructive">
                  <Trash2 className="size-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all call history?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all call entries from your list. Calls you started are deleted for everyone; incoming calls are only hidden for you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={clearAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
