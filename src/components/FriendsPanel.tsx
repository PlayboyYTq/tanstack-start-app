import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { Search, UserPlus, Check, X, Clock, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Profile = { id: string; name: string; avatar_url: string | null; status: string; masked_phone?: string | null };
type SearchMode = "name" | "phone";
type FriendRequest = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
};

type Section = "friends" | "requests" | "discover";

export function FriendsPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState<Section>("friends");
  const [friends, setFriends] = useState<Profile[]>([]);
  const [incoming, setIncoming] = useState<Array<FriendRequest & { profile: Profile }>>([]);
  const [outgoing, setOutgoing] = useState<Array<FriendRequest & { profile: Profile }>>([]);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("name");
  const [discover, setDiscover] = useState<Profile[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: fs }, { data: reqs }] = await Promise.all([
      supabase.from("friendships").select("*").or(`user_a.eq.${user.id},user_b.eq.${user.id}`),
      supabase
        .from("friend_requests")
        .select("*")
        .eq("status", "pending")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`),
    ]);

    const friendIds = (fs ?? []).map((f) => (f.user_a === user.id ? f.user_b : f.user_a));
    const inc = (reqs ?? []).filter((r) => r.receiver_id === user.id);
    const out = (reqs ?? []).filter((r) => r.sender_id === user.id);
    const allIds = Array.from(new Set([...friendIds, ...inc.map((r) => r.sender_id), ...out.map((r) => r.receiver_id)]));

    const { data: profs } = allIds.length
      ? await supabase.from("profiles").select("id,name,avatar_url,status").in("id", allIds)
      : { data: [] as Profile[] };
    const pmap = new Map((profs ?? []).map((p) => [p.id, p as Profile]));

    setFriends(friendIds.map((id) => pmap.get(id)).filter(Boolean) as Profile[]);
    setIncoming(inc.map((r) => ({ ...(r as FriendRequest), profile: pmap.get(r.sender_id)! })).filter((r) => r.profile));
    setOutgoing(out.map((r) => ({ ...(r as FriendRequest), profile: pmap.get(r.receiver_id)! })).filter((r) => r.profile));
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;
    const channel = supabase
      .channel("friends-panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, load]);

  // Discover search (name OR phone)
  useEffect(() => {
    if (section !== "discover" || !user) return;
    const q = search.trim();
    if (!q) {
      setDiscover([]);
      return;
    }
    const t = setTimeout(async () => {
      setDiscoverLoading(true);
      const friendIds = new Set(friends.map((f) => f.id));
      const reqIds = new Set([...incoming.map((r) => r.profile.id), ...outgoing.map((r) => r.profile.id)]);
      if (searchMode === "phone") {
        const { data, error } = await supabase.rpc("search_user_by_phone", { _phone: q });
        if (error) {
          setDiscover([]);
        } else {
          setDiscover(
            ((data ?? []) as Array<{ id: string; name: string; avatar_url: string | null; masked_phone: string | null }>)
              .filter((p) => !friendIds.has(p.id) && !reqIds.has(p.id))
              .map((p) => ({ id: p.id, name: p.name, avatar_url: p.avatar_url, status: "offline", masked_phone: p.masked_phone }))
          );
        }
      } else {
        const { data: blocks } = await supabase.from("user_blocks").select("blocked_id").eq("blocker_id", user.id);
        const blockedIds = new Set((blocks ?? []).map((b) => b.blocked_id));
        const { data } = await supabase
          .from("profiles")
          .select("id,name,avatar_url,status")
          .ilike("name", `%${q}%`)
          .neq("id", user.id)
          .limit(30);
        setDiscover(
          ((data ?? []) as Profile[]).filter(
            (p) => !friendIds.has(p.id) && !reqIds.has(p.id) && !blockedIds.has(p.id)
          )
        );
      }
      setDiscoverLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [search, searchMode, section, user?.id, friends, incoming, outgoing]);

  const sendRequest = async (p: Profile) => {
    if (!user) return;
    const { error } = await supabase.from("friend_requests").insert({ sender_id: user.id, receiver_id: p.id });
    if (error) return toast.error(error.message);
    toast.success(`Request sent to ${p.name}`);
    setDiscover((prev) => prev.filter((x) => x.id !== p.id));
  };

  const respond = async (req: FriendRequest, status: "accepted" | "declined") => {
    const { error } = await supabase.from("friend_requests").update({ status }).eq("id", req.id);
    if (error) return toast.error(error.message);
    toast.success(status === "accepted" ? "Friend added" : "Request declined");
  };

  const cancelRequest = async (req: FriendRequest) => {
    const { error } = await supabase.from("friend_requests").delete().eq("id", req.id);
    if (error) return toast.error(error.message);
  };

  const startChat = async (other: Profile) => {
    if (!user) return;
    const [a, b] = [user.id, other.id].sort();
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", a)
      .eq("user_b", b)
      .maybeSingle();
    if (existing) {
      navigate({ to: "/chats/$conversationId", params: { conversationId: existing.id } });
      return;
    }
    const { data, error } = await supabase.from("conversations").insert({ user_a: a, user_b: b }).select("id").single();
    if (error) return toast.error(error.message);
    navigate({ to: "/chats/$conversationId", params: { conversationId: data.id } });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 pt-2 pb-3">
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-muted/60">
          <SectionTab active={section === "friends"} onClick={() => setSection("friends")} label="Friends" count={friends.length} />
          <SectionTab active={section === "requests"} onClick={() => setSection("requests")} label="Requests" count={incoming.length} highlight={incoming.length > 0} />
          <SectionTab active={section === "discover"} onClick={() => setSection("discover")} label="Discover" />
        </div>
      </div>

      {section === "discover" && (
        <div className="px-3 pb-2 space-y-2">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted/60">
            <button
              onClick={() => { setSearchMode("name"); setSearch(""); setDiscover([]); }}
              className={cn(
                "h-8 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                searchMode === "name" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              )}
            >
              <Search className="size-3.5" /> By name
            </button>
            <button
              onClick={() => { setSearchMode("phone"); setSearch(""); setDiscover([]); }}
              className={cn(
                "h-8 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                searchMode === "phone" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              )}
            >
              <Phone className="size-3.5" /> By phone
            </button>
          </div>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchMode === "phone" ? "Exact phone, e.g. +919876543210" : "Search people by name"}
              inputMode={searchMode === "phone" ? "tel" : "text"}
              className="pl-9 h-10 rounded-xl bg-muted/60 border-transparent focus-visible:bg-background"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {section === "friends" && (
          friends.length === 0 ? (
            <EmptyState title="No friends yet" hint="Find people in Discover and send a request." />
          ) : (
            friends.map((p) => (
              <Row key={p.id} profile={p}>
                <Button size="sm" variant="secondary" className="rounded-full h-8" onClick={() => startChat(p)}>
                  <MessageCircle className="size-3.5 mr-1.5" /> Message
                </Button>
              </Row>
            ))
          )
        )}

        {section === "requests" && (
          <>
            {incoming.length === 0 && outgoing.length === 0 && (
              <EmptyState title="No pending requests" hint="Incoming and sent requests will appear here." />
            )}
            {incoming.length > 0 && (
              <SectionLabel>Incoming · {incoming.length}</SectionLabel>
            )}
            {incoming.map((r) => (
              <Row key={r.id} profile={r.profile}>
                <div className="flex items-center gap-1.5">
                  <Button size="icon" variant="default" className="size-8 rounded-full" onClick={() => respond(r, "accepted")}>
                    <Check className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => respond(r, "declined")}>
                    <X className="size-4" />
                  </Button>
                </div>
              </Row>
            ))}
            {outgoing.length > 0 && (
              <SectionLabel>Sent · {outgoing.length}</SectionLabel>
            )}
            {outgoing.map((r) => (
              <Row key={r.id} profile={r.profile} subtitle="Pending">
                <Button size="sm" variant="ghost" className="rounded-full h-8" onClick={() => cancelRequest(r)}>
                  <Clock className="size-3.5 mr-1.5" /> Cancel
                </Button>
              </Row>
            ))}
          </>
        )}

        {section === "discover" && (
          <>
            {!search && (
              <EmptyState
                title={searchMode === "phone" ? "Find by phone number" : "Find new people"}
                hint={searchMode === "phone" ? "Enter the exact number including country code (e.g. +91…)." : "Search by name to send a friend request."}
              />
            )}
            {search && discoverLoading && <div className="px-4 py-3 text-sm text-muted-foreground">Searching…</div>}
            {search && !discoverLoading && discover.length === 0 && (
              <EmptyState
                title="No users found"
                hint={searchMode === "phone" ? "No account uses this exact number." : "Try a different name."}
              />
            )}
            {discover.map((p) => (
              <Row key={p.id} profile={p} subtitle={p.masked_phone ?? undefined}>
                <Button size="sm" variant="secondary" className="rounded-full h-8" onClick={() => sendRequest(p)}>
                  <UserPlus className="size-3.5 mr-1.5" /> Add
                </Button>
              </Row>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SectionTab({ active, onClick, label, count, highlight }: { active: boolean; onClick: () => void; label: string; count?: number; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-9 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5",
        active ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className={cn(
          "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
          highlight ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}>{count}</span>
      )}
    </button>
  );
}

function Row({ profile, subtitle, children }: { profile: Profile; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40">
      <div className="relative">
        <Avatar className="size-11">
          <AvatarImage src={profile.avatar_url ?? undefined} />
          <AvatarFallback>{initials(profile.name)}</AvatarFallback>
        </Avatar>
        {profile.status === "online" && (
          <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-online ring-2 ring-sidebar" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{profile.name}</div>
        <div className="text-xs text-muted-foreground capitalize">{subtitle ?? profile.status}</div>
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{children}</div>;
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto size-12 rounded-2xl bg-accent grid place-items-center mb-3">
        <UserPlus className="size-5 text-accent-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}
