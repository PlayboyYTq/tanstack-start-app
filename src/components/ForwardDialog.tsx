import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";
import { Search, Forward, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Friend = { id: string; name: string; avatar_url: string | null };

export type ForwardPayload = {
  content: string;
  media_url: string | null;
  media_type: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: ForwardPayload | null;
};

export function ForwardDialog({ open, onOpenChange, payload }: Props) {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setSelected(new Set());
    setQ("");
    setLoading(true);
    (async () => {
      const { data: fs } = await supabase
        .from("friendships")
        .select("user_a,user_b")
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
      const ids = (fs ?? []).map((f) => (f.user_a === user.id ? f.user_b : f.user_a));
      if (!ids.length) { setFriends([]); setLoading(false); return; }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,name,avatar_url")
        .in("id", ids);
      setFriends((profs ?? []) as Friend[]);
      setLoading(false);
    })();
  }, [open, user]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return friends;
    return friends.filter((f) => f.name.toLowerCase().includes(term));
  }, [q, friends]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onForward = async () => {
    if (!user || !payload || selected.size === 0) return;
    setSending(true);
    try {
      // Ensure a conversation exists with each selected friend, then insert the message.
      for (const friendId of selected) {
        const [a, b] = [user.id, friendId].sort();
        let { data: conv } = await supabase
          .from("conversations")
          .select("id")
          .eq("user_a", a)
          .eq("user_b", b)
          .maybeSingle();
        if (!conv) {
          const { data: created, error } = await supabase
            .from("conversations")
            .insert({ user_a: a, user_b: b })
            .select("id")
            .single();
          if (error) throw error;
          conv = created;
        }
        if (!conv) continue;
        const { error: msgErr } = await supabase.from("messages").insert({
          conversation_id: conv.id,
          sender_id: user.id,
          content: payload.content ?? "",
          media_url: payload.media_url,
          media_type: payload.media_type,
        });
        if (msgErr) throw msgErr;
      }
      toast.success(selected.size === 1 ? "Message forwarded" : `Forwarded to ${selected.size} chats`);
      onOpenChange(false);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e.message ?? "Failed to forward");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Forward className="size-5 text-primary" /> Forward to…
          </DialogTitle>
          <DialogDescription>Select one or more friends to send this message to.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search friends" className="pl-9 rounded-xl" />
        </div>

        <div className="max-h-72 overflow-y-auto -mx-2 mt-2">
          {loading && <div className="text-sm text-muted-foreground px-3 py-4">Loading friends…</div>}
          {!loading && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground px-3 py-4">{friends.length === 0 ? "No friends yet." : "No matches."}</div>
          )}
          {filtered.map((f) => {
            const isSel = selected.has(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent/50 transition text-left"
              >
                <Avatar className="size-10">
                  <AvatarImage src={f.avatar_url ?? undefined} />
                  <AvatarFallback>{initials(f.name)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 font-medium truncate">{f.name}</div>
                <span className={`size-5 rounded-full grid place-items-center border-2 transition ${isSel ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"}`}>
                  {isSel && <Check className="size-3" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
            <Button onClick={onForward} disabled={sending || selected.size === 0} className="rounded-xl">
              {sending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Forward
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
