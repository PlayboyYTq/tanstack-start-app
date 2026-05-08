import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initials } from "@/lib/format";
import { Users, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Friend = { id: string; name: string; avatar_url: string | null };

export function CreateGroupDialog({ onCreated }: { onCreated: (groupId: string) => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setName(""); setSelected(new Set()); setNameError(null);
    (async () => {
      const { data: fs } = await supabase
        .from("friendships")
        .select("*")
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
      const ids = (fs ?? []).map((f) => (f.user_a === user.id ? f.user_b : f.user_a));
      if (!ids.length) return setFriends([]);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,name,avatar_url")
        .in("id", ids);
      setFriends((profs ?? []) as Friend[]);
    })();
  }, [open, user]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) { setNameError("Group name is required"); return; }
    if (trimmed.length > 60) { setNameError("Name must be 60 characters or less"); return; }
    if (selected.size === 0) { toast.error("Add at least one member"); return; }
    setBusy(true);
    const { data: groupId, error } = await supabase.rpc("create_group_with_members", {
      _name: trimmed,
      _member_ids: Array.from(selected),
    });
    setBusy(false);
    if (error || !groupId) {
      toast.error(error?.message ?? "Could not create group");
      return;
    }
    toast.success("Group created");
    setOpen(false);
    onCreated(groupId as string);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="rounded-full" title="Create group">
          <Users className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a group</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); if (nameError) setNameError(null); }}
              placeholder="Weekend plans"
              maxLength={60}
              aria-invalid={!!nameError}
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Add members ({selected.size})</Label>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
              {friends.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No friends yet — add some first.
                </div>
              )}
              {friends.map((f) => {
                const on = selected.has(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/60 transition-colors", on && "bg-accent/40")}
                  >
                    <Avatar className="size-10">
                      <AvatarImage src={f.avatar_url ?? undefined} />
                      <AvatarFallback>{initials(f.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 font-medium truncate">{f.name}</div>
                    <div className={cn("size-5 rounded-full grid place-items-center border", on ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                      {on && <Check className="size-3.5" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create group"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
