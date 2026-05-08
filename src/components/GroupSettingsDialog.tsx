import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { initials } from "@/lib/format";
import { Crown, Shield, ShieldCheck, UserMinus, UserPlus, X, Save, Loader2, LogOut, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type GroupSettingsValue = {
  id: string;
  name: string;
  avatar_url: string | null;
  who_can_send: "owner" | "admin" | "member";
  who_can_edit_info: "owner" | "admin" | "member";
  who_can_add_members: "owner" | "admin" | "member";
};

type Member = {
  user_id: string;
  role: "owner" | "admin" | "member";
  name: string;
  avatar_url: string | null;
};

type Friend = { id: string; name: string; avatar_url: string | null };

export function GroupSettingsDialog({
  open,
  onOpenChange,
  group,
  myRole,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: GroupSettingsValue;
  myRole: "owner" | "admin" | "member";
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [name, setName] = useState(group.name);
  const [whoSend, setWhoSend] = useState(group.who_can_send);
  const [whoEdit, setWhoEdit] = useState(group.who_can_edit_info);
  const [whoAdd, setWhoAdd] = useState(group.who_can_add_members);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingPerms, setSavingPerms] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string>("");
  const [leaving, setLeaving] = useState(false);

  const canEditInfo = useMemo(() => roleAtLeast(myRole, group.who_can_edit_info), [myRole, group.who_can_edit_info]);
  const canManagePerms = myRole === "owner";
  const canAddMembers = useMemo(() => roleAtLeast(myRole, group.who_can_add_members), [myRole, group.who_can_add_members]);
  const canRemoveMembers = myRole === "owner" || myRole === "admin";

  useEffect(() => {
    if (!open) return;
    setName(group.name);
    setWhoSend(group.who_can_send);
    setWhoEdit(group.who_can_edit_info);
    setWhoAdd(group.who_can_add_members);
    void loadMembers();
    void loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group.id]);

  const loadMembers = async () => {
    const { data: rows } = await supabase
      .from("group_members")
      .select("user_id,role")
      .eq("group_id", group.id);
    const ids = (rows ?? []).map((r) => r.user_id);
    if (!ids.length) return setMembers([]);
    const { data: profs } = await supabase.from("profiles").select("id,name,avatar_url").in("id", ids);
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    setMembers(
      (rows ?? []).map((r) => ({
        user_id: r.user_id,
        role: r.role as Member["role"],
        name: byId.get(r.user_id)?.name ?? "Member",
        avatar_url: byId.get(r.user_id)?.avatar_url ?? null,
      })),
    );
  };

  const loadFriends = async () => {
    if (!user) return;
    const { data: fs } = await supabase
      .from("friendships")
      .select("*")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
    const ids = (fs ?? []).map((f) => (f.user_a === user.id ? f.user_b : f.user_a));
    if (!ids.length) return setFriends([]);
    const { data: profs } = await supabase.from("profiles").select("id,name,avatar_url").in("id", ids);
    setFriends((profs ?? []) as Friend[]);
  };

  const saveInfo = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Group name is required");
    setSavingInfo(true);
    const { error } = await supabase.from("groups").update({ name: trimmed }).eq("id", group.id);
    setSavingInfo(false);
    if (error) return toast.error(error.message);
    toast.success("Group info updated");
    onChanged();
  };

  const savePermissions = async () => {
    setSavingPerms(true);
    const { error } = await supabase
      .from("groups")
      .update({ who_can_send: whoSend, who_can_edit_info: whoEdit, who_can_add_members: whoAdd })
      .eq("id", group.id);
    setSavingPerms(false);
    if (error) return toast.error(error.message);
    toast.success("Permissions updated");
    onChanged();
  };

  const promote = async (userId: string, role: "admin" | "member") => {
    const { error } = await supabase
      .from("group_members")
      .update({ role })
      .eq("group_id", group.id)
      .eq("user_id", userId);
    if (error) return toast.error(error.message);
    toast.success(role === "admin" ? "Promoted to admin" : "Demoted to member");
    void loadMembers();
  };

  const removeMember = async (userId: string) => {
    const { error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", userId);
    if (error) return toast.error(error.message);
    toast.success("Member removed");
    void loadMembers();
    onChanged();
  };

  const addMember = async (userId: string) => {
    const { error } = await supabase
      .from("group_members")
      .insert({ group_id: group.id, user_id: userId, role: "member" });
    if (error) return toast.error(error.message);
    toast.success("Member added");
    void loadMembers();
    onChanged();
  };

  const memberIds = new Set(members.map((m) => m.user_id));
  const eligibleFriends = friends.filter((f) => !memberIds.has(f.id));
  const otherAdmins = members.filter((m) => m.role === "admin" && m.user_id !== user?.id);

  const leaveGroup = async () => {
    if (!user) return;
    setLeaving(true);
    const { error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", user.id);
    setLeaving(false);
    if (error) return toast.error(error.message);
    toast.success("You left the group");
    setLeaveOpen(false);
    onOpenChange(false);
    navigate({ to: "/chats" });
  };

  const transferAndLeave = async () => {
    if (!user || !transferTarget) return toast.error("Pick an admin to transfer to");
    setLeaving(true);
    // Promote target to owner, demote self to member, then remove self.
    const { error: promoteErr } = await supabase
      .from("group_members")
      .update({ role: "owner" })
      .eq("group_id", group.id)
      .eq("user_id", transferTarget);
    if (promoteErr) { setLeaving(false); return toast.error(promoteErr.message); }
    const { error: demoteErr } = await supabase
      .from("group_members")
      .update({ role: "member" })
      .eq("group_id", group.id)
      .eq("user_id", user.id);
    if (demoteErr) { setLeaving(false); return toast.error(demoteErr.message); }
    const { error: leaveErr } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", user.id);
    setLeaving(false);
    if (leaveErr) return toast.error(leaveErr.message);
    toast.success("Ownership transferred. You left the group.");
    setTransferOpen(false);
    onOpenChange(false);
    navigate({ to: "/chats" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Group settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Group info */}
          <section className="space-y-2">
            <Label htmlFor="grp-name">Group name</Label>
            <div className="flex gap-2">
              <Input
                id="grp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEditInfo || savingInfo}
                maxLength={60}
              />
              {canEditInfo && (
                <Button onClick={saveInfo} disabled={savingInfo || name.trim() === group.name} size="sm" className="shrink-0">
                  {savingInfo ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                </Button>
              )}
            </div>
            {!canEditInfo && (
              <p className="text-xs text-muted-foreground">Only {labelFor(group.who_can_edit_info)}s can edit group info.</p>
            )}
          </section>

          {/* Permissions */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              <h3 className="font-semibold text-sm">Permissions</h3>
              {!canManagePerms && <span className="text-[11px] text-muted-foreground">(owner only)</span>}
            </div>
            <PermRow
              label="Who can send messages"
              value={whoSend}
              onChange={setWhoSend}
              disabled={!canManagePerms}
            />
            <PermRow
              label="Who can edit group info"
              value={whoEdit}
              onChange={setWhoEdit}
              disabled={!canManagePerms}
            />
            <PermRow
              label="Who can add new members"
              value={whoAdd}
              onChange={setWhoAdd}
              disabled={!canManagePerms}
            />
            {canManagePerms && (
              <Button
                size="sm"
                variant="outline"
                onClick={savePermissions}
                disabled={
                  savingPerms ||
                  (whoSend === group.who_can_send &&
                    whoEdit === group.who_can_edit_info &&
                    whoAdd === group.who_can_add_members)
                }
              >
                {savingPerms ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
                Save permissions
              </Button>
            )}
          </section>

          {/* Members */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{members.length} member{members.length === 1 ? "" : "s"}</h3>
              {canAddMembers && (
                <Button size="sm" variant="ghost" onClick={() => setAddOpen((v) => !v)}>
                  <UserPlus className="size-4 mr-1.5" /> Add
                </Button>
              )}
            </div>

            {addOpen && canAddMembers && (
              <div className="rounded-xl border border-border max-h-48 overflow-y-auto">
                {eligibleFriends.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">No friends left to add.</p>
                ) : (
                  eligibleFriends.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => addMember(f.id)}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent/60 text-left"
                    >
                      <Avatar className="size-8">
                        <AvatarImage src={f.avatar_url ?? undefined} />
                        <AvatarFallback>{initials(f.name)}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 truncate text-sm font-medium">{f.name}</span>
                      <UserPlus className="size-4 text-primary" />
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="rounded-xl border border-border divide-y divide-border">
              {members.map((m) => {
                const isMe = m.user_id === user?.id;
                return (
                  <div key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar className="size-9">
                      <AvatarImage src={m.avatar_url ?? undefined} />
                      <AvatarFallback>{initials(m.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {m.name}{isMe && <span className="text-muted-foreground font-normal"> · you</span>}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {m.role === "owner" && <><Crown className="size-3 text-amber-500" /> Owner</>}
                        {m.role === "admin" && <><Shield className="size-3 text-primary" /> Admin</>}
                        {m.role === "member" && <>Member</>}
                      </div>
                    </div>
                    {canManagePerms && m.role !== "owner" && !isMe && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => promote(m.user_id, m.role === "admin" ? "member" : "admin")}
                      >
                        {m.role === "admin" ? "Demote" : "Make admin"}
                      </Button>
                    )}
                    {canRemoveMembers && m.role !== "owner" && !isMe && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => removeMember(m.user_id)}
                        aria-label={`Remove ${m.name}`}
                      >
                        <UserMinus className="size-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Danger zone */}
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="font-semibold text-sm text-destructive">Danger zone</h3>
            {myRole === "owner" ? (
              otherAdmins.length > 0 ? (
                <Button variant="outline" className="w-full justify-start text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setTransferOpen(true)}>
                  <ArrowRightLeft className="size-4 mr-2" /> Transfer ownership & leave
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  As the owner you can't leave until you promote another member to admin and transfer ownership.
                </p>
              )
            ) : (
              <Button variant="outline" className="w-full justify-start text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setLeaveOpen(true)}>
                <LogOut className="size-4 mr-2" /> Leave group
              </Button>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="size-4 mr-1.5" /> Close
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this group?</AlertDialogTitle>
            <AlertDialogDescription>
              You won't receive new messages from this group. You can be re-added by an admin later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={leaveGroup} disabled={leaving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {leaving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <LogOut className="size-4 mr-2" />}
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={transferOpen} onOpenChange={setTransferOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership</AlertDialogTitle>
            <AlertDialogDescription>
              Pick an admin to become the new owner. After the transfer you'll leave the group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Select value={transferTarget} onValueChange={setTransferTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Choose new owner" />
              </SelectTrigger>
              <SelectContent>
                {otherAdmins.map((a) => (
                  <SelectItem key={a.user_id} value={a.user_id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={transferAndLeave} disabled={leaving || !transferTarget} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {leaving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ArrowRightLeft className="size-4 mr-2" />}
              Transfer & leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function PermRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: "owner" | "admin" | "member";
  onChange: (v: "owner" | "admin" | "member") => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", disabled && "opacity-70")}>
      <Label className="text-sm">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as "owner" | "admin" | "member")} disabled={disabled}>
        <SelectTrigger className="w-36 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="owner">Owner only</SelectItem>
          <SelectItem value="admin">Owner & admins</SelectItem>
          <SelectItem value="member">All members</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function labelFor(v: "owner" | "admin" | "member") {
  return v === "owner" ? "owner" : v === "admin" ? "admin" : "member";
}

function roleAtLeast(role: "owner" | "admin" | "member", min: "owner" | "admin" | "member"): boolean {
  const rank = { member: 1, admin: 2, owner: 3 } as const;
  return rank[role] >= rank[min];
}
