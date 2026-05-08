import { createFileRoute, Outlet, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatChatListTime, initials } from "@/lib/format";
import { MessageCircle, MessageSquare, Plus, Search, LogOut, User as UserIcon, ArrowLeft, Users, Smartphone, Settings as SettingsIcon, Sparkles, CircleDot, PhoneCall, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { FriendsPanel } from "@/components/FriendsPanel";
import { CreateGroupDialog } from "@/components/CreateGroupDialog";
import { playMessageSound } from "@/lib/sound";
import { ensureNotificationPermission, notifyIfHidden, setTitleBadge } from "@/lib/notifications";
import { isDesktopDevice } from "@/lib/device";
import { usePresence } from "@/lib/presence";
import { ChatListSkeleton } from "@/components/ChatListSkeleton";
import { StatusTab } from "@/components/StatusTab";
import { CallsTab } from "@/components/CallsTab";

const MISSED_SEEN_KEY = "circle:missed-calls-seen:v1";

export const Route = createFileRoute("/chats")({
  component: ChatsLayout,
});

type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  last_message_at: string;
};

type Profile = { id: string; name: string; avatar_url: string | null; status: string };

type ChatItem = {
  conversationId?: string;
  groupId?: string;
  otherUserId?: string;
  isGroup: boolean;
  title: string;
  avatarUrl: string | null;
  status?: string;
  lastMessage?: { content: string; created_at: string; sender_id: string };
  lastMessageAt: string;
};

const CHATS_CACHE_KEY = "circle:chats-cache:v1";
const ASKIFY_HISTORY_KEY = "askify-history-v1";

function hasUsedAskify(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(ASKIFY_HISTORY_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw) as Array<{ role?: string }>;
    return Array.isArray(arr) && arr.some((m) => m?.role === "user");
  } catch { return false; }
}

function loadChatsCache(userId: string | undefined): ChatItem[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(`${CHATS_CACHE_KEY}:${userId}`);
    if (!raw) return [];
    return JSON.parse(raw) as ChatItem[];
  } catch { return []; }
}

function saveChatsCache(userId: string | undefined, chats: ChatItem[]) {
  if (!userId || typeof window === "undefined") return;
  try { sessionStorage.setItem(`${CHATS_CACHE_KEY}:${userId}`, JSON.stringify(chats)); } catch { /* ignore */ }
}

function ChatsLayout() {
  const { user, profile, signOut, loading } = useAuth();
  const { isOnline } = usePresence();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const [topTab, setTopTab] = useState<"chats" | "status" | "calls">("chats");
  const [fabOpen, setFabOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [chats, setChats] = useState<ChatItem[]>(() => loadChatsCache(undefined));
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [missedCount, setMissedCount] = useState(0);
  const [listChannelVersion, setListChannelVersion] = useState(0);
  const activeConvRef = useRef<string | undefined>(undefined);
  activeConvRef.current = params.conversationId;
  const userIdRef = useRef<string | undefined>(undefined);
  userIdRef.current = user?.id;
  const listReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate chats from cache as soon as we know the user (instant render).
  useEffect(() => {
    if (user?.id) {
      const cached = loadChatsCache(user.id);
      if (cached.length) setChats(cached);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const loadChats = async () => {
    if (!user) return;
    const [{ data: convs }, { data: gms }] = await Promise.all([
      supabase
        .from("conversations")
        .select("*")
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
        .order("last_message_at", { ascending: false }),
      supabase
        .from("group_members")
        .select("group_id, groups(id,name,avatar_url,last_message_at)")
        .eq("user_id", user.id),
    ]);
    const safeConvs = (convs ?? []) as ConversationRow[];
    const groups = (gms ?? [])
      .map((m) => m.groups)
      .filter(Boolean) as Array<{ id: string; name: string; avatar_url: string | null; last_message_at: string }>;

    const otherIds = safeConvs.map((c) => (c.user_a === user.id ? c.user_b : c.user_a));
    const { data: profiles } = otherIds.length
      ? await supabase.from("profiles").select("id,name,avatar_url,status").in("id", otherIds)
      : { data: [] as Profile[] };

    const lastMap = new Map<string, { content: string; created_at: string; sender_id: string }>();
    await Promise.all([
      ...safeConvs.map(async (c) => {
        const { data: m } = await supabase
          .from("messages")
          .select("content,created_at,sender_id")
          .eq("conversation_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (m) lastMap.set(`c:${c.id}`, m as { content: string; created_at: string; sender_id: string });
      }),
      ...groups.map(async (g) => {
        const { data: m } = await supabase
          .from("messages")
          .select("content,created_at,sender_id")
          .eq("group_id", g.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (m) lastMap.set(`g:${g.id}`, m as { content: string; created_at: string; sender_id: string });
      }),
    ]);
    const profileMap = new Map((profiles ?? []).map((p: Profile) => [p.id, p]));
    const convItems: ChatItem[] = safeConvs.map((c) => {
      const otherId = c.user_a === user.id ? c.user_b : c.user_a;
      const other = profileMap.get(otherId) ?? { id: otherId, name: "Unknown", avatar_url: null, status: "offline" };
      return {
        conversationId: c.id,
        otherUserId: otherId,
        isGroup: false,
        title: other.name,
        avatarUrl: other.avatar_url,
        status: other.status,
        lastMessage: lastMap.get(`c:${c.id}`),
        lastMessageAt: c.last_message_at,
      };
    });
    const groupItems: ChatItem[] = groups.map((g) => ({
      groupId: g.id,
      isGroup: true,
      title: g.name,
      avatarUrl: g.avatar_url,
      lastMessage: lastMap.get(`g:${g.id}`),
      lastMessageAt: g.last_message_at,
    }));
    const merged = [...convItems, ...groupItems].sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
    setChats(merged);
    setChatsLoaded(true);
    saveChatsCache(user.id, merged);
  };

  const loadUnread = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("messages")
      .select("conversation_id")
      .neq("sender_id", user.id)
      .neq("status", "read")
      .not("conversation_id", "is", null)
      .limit(1000);
    const counts: Record<string, number> = {};
    (data ?? []).forEach((m: { conversation_id: string | null }) => {
      if (!m.conversation_id) return;
      counts[m.conversation_id] = (counts[m.conversation_id] ?? 0) + 1;
    });
    setUnread(counts);
  };

  const loadPendingCount = async () => {
    if (!user) return;
    const { count } = await supabase
      .from("friend_requests")
      .select("*", { count: "exact", head: true })
      .eq("receiver_id", user.id)
      .eq("status", "pending");
    setPendingRequests(count ?? 0);
  };

  const loadMissedCount = async () => {
    if (!user || typeof window === "undefined") return;
    // Find conversations the user is in
    const { data: convs } = await supabase
      .from("conversations")
      .select("id")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
    const ids = (convs ?? []).map((c) => c.id);
    if (!ids.length) { setMissedCount(0); return; }
    // Missed calls = system messages from the OTHER party that say Missed/No answer.
    const { data: msgs } = await supabase
      .from("messages")
      .select("id,sender_id,content,created_at")
      .in("conversation_id", ids)
      .neq("sender_id", user.id)
      .or("content.ilike.📞%,content.ilike.📹%")
      .order("created_at", { ascending: false })
      .limit(100);
    const missed = (msgs ?? []).filter((m) =>
      /missed|no answer/i.test(m.content)
    );
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(`${MISSED_SEEN_KEY}:${user.id}`) ?? "[]"); } catch { seen = []; }
    const seenSet = new Set(seen);
    const unseen = missed.filter((m) => !seenSet.has(m.id));
    setMissedCount(unseen.length);
  };

  const markMissedSeen = async () => {
    if (!user || typeof window === "undefined") return;
    const { data: convs } = await supabase
      .from("conversations")
      .select("id")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
    const ids = (convs ?? []).map((c) => c.id);
    if (!ids.length) { setMissedCount(0); return; }
    const { data: msgs } = await supabase
      .from("messages")
      .select("id,content")
      .in("conversation_id", ids)
      .neq("sender_id", user.id)
      .or("content.ilike.📞%,content.ilike.📹%")
      .order("created_at", { ascending: false })
      .limit(200);
    const allMissedIds = (msgs ?? [])
      .filter((m) => /missed|no answer/i.test(m.content))
      .map((m) => m.id);
    try { localStorage.setItem(`${MISSED_SEEN_KEY}:${user.id}`, JSON.stringify(allMissedIds)); } catch { /* ignore */ }
    setMissedCount(0);
  };

  useEffect(() => {
    loadChats();
    loadUnread();
    loadPendingCount();
    loadMissedCount();
    if (!user) return;
    let disposed = false;
    const scheduleReconnect = () => {
      if (disposed || listReconnectTimerRef.current) return;
      listReconnectTimerRef.current = setTimeout(() => {
        listReconnectTimerRef.current = null;
        setListChannelVersion((value) => value + 1);
      }, 1000);
    };

    const channel = supabase
      .channel(`chats-list:${user.id}:${listChannelVersion}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadChats())
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const m = payload.new as { id: string; conversation_id: string; sender_id: string; content: string; status: string };
          // Patch chat list locally for instant update (no full refetch).
          const createdAt = (payload.new as { created_at?: string }).created_at ?? new Date().toISOString();
          setChats((prev) => {
            const key = m.conversation_id;
            if (!key) return prev;
            const idx = prev.findIndex((c) => c.conversationId === key);
            if (idx === -1) {
              // Conversation not in cache yet — fall back to full reload.
              loadChats();
              return prev;
            }
            const updated: ChatItem = {
              ...prev[idx],
              lastMessage: { content: m.content, created_at: createdAt, sender_id: m.sender_id },
              lastMessageAt: createdAt,
            };
            const next = [updated, ...prev.filter((_, i) => i !== idx)];
            saveChatsCache(userIdRef.current, next);
            return next;
          });
          // Also handle group messages
          const groupId = (payload.new as { group_id?: string | null }).group_id;
          if (groupId) {
            setChats((prev) => {
              const idx = prev.findIndex((c) => c.groupId === groupId);
              if (idx === -1) { loadChats(); return prev; }
              const updated: ChatItem = {
                ...prev[idx],
                lastMessage: { content: m.content, created_at: createdAt, sender_id: m.sender_id },
                lastMessageAt: createdAt,
              };
              const next = [updated, ...prev.filter((_, i) => i !== idx)];
              saveChatsCache(userIdRef.current, next);
              return next;
            });
          }
          if (m.sender_id === userIdRef.current) return;
          // RLS already filters server-side; double-check client-side that this convo is mine.
          const { data: isMine } = await supabase
            .from("conversations")
            .select("id")
            .eq("id", m.conversation_id)
            .maybeSingle();
          if (!isMine) return;
          // Mark as delivered as soon as our client receives it (recipient online).
          // The chat view will further upgrade it to "read" if open.
          if (m.status === "sent") {
            void supabase.from("messages").update({ status: "delivered" }).eq("id", m.id);
          }
          if (activeConvRef.current === m.conversation_id) return;
          setUnread((prev) => ({ ...prev, [m.conversation_id]: (prev[m.conversation_id] ?? 0) + 1 }));
          playMessageSound();
          const { data: sender } = await supabase
            .from("profiles")
            .select("name,avatar_url")
            .eq("id", m.sender_id)
            .maybeSingle();
          const senderName = sender?.name ?? "New message";
          const preview = m.content.length > 80 ? m.content.slice(0, 80) + "…" : m.content;
          toast(senderName, {
            description: preview,
            action: {
              label: "Open",
              onClick: () => navigate({ to: "/chats/$conversationId", params: { conversationId: m.conversation_id } }),
            },
          });
          notifyIfHidden({
            title: senderName,
            body: preview,
            icon: sender?.avatar_url ?? "/icon-192.png",
            tag: `msg:${m.conversation_id}`,
            onClick: () => navigate({ to: "/chats/$conversationId", params: { conversationId: m.conversation_id } }),
          });
        }
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, () => {
        loadUnread();
        loadMissedCount();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, () => loadChats())
      .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => {
        loadPendingCount();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => loadChats())
      .on("postgres_changes", { event: "*", schema: "public", table: "user_blocks" }, () => loadChats())
      .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, () => loadChats())
      .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, () => loadChats())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (listReconnectTimerRef.current) {
            clearTimeout(listReconnectTimerRef.current);
            listReconnectTimerRef.current = null;
          }
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleReconnect();
        }
      });
    return () => {
      disposed = true;
      if (listReconnectTimerRef.current) {
        clearTimeout(listReconnectTimerRef.current);
        listReconnectTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, listChannelVersion]);

  // Clear unread for the currently open conversation
  useEffect(() => {
    if (!params.conversationId) return;
    setUnread((prev) => {
      if (!prev[params.conversationId!]) return prev;
      const next = { ...prev };
      delete next[params.conversationId!];
      return next;
    });
  }, [params.conversationId]);

  const filtered = chats.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));
  const showSidebarOnMobile = !params.conversationId;
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);

  // Title badge with unread count
  useEffect(() => {
    setTitleBadge(totalUnread);
    return () => setTitleBadge(0);
  }, [totalUnread]);

  // Ask for notification permission and subscribe to push once after sign-in
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(async () => {
      const perm = await ensureNotificationPermission();
      if (perm === "granted") {
        const { subscribeToPush } = await import("@/lib/push");
        void subscribeToPush(user.id);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [user?.id]);

  // No more blocking AppLoader — render the shell immediately and show
  // skeletons inside the chat list while data loads. Auth guard runs in effect.

  return (
    <div className="h-screen flex bg-background">
      <aside
        className={cn(
          "surface-panel w-full md:w-[360px] md:border-r border-border/70 flex flex-col bg-sidebar/80 backdrop-blur-xl",
          showSidebarOnMobile ? "flex" : "hidden md:flex"
        )}
      >
        <header className="px-4 py-3 flex items-center justify-between border-b border-border/70">
          <div className="flex items-center gap-2">
            <div className="size-9 rounded-2xl bg-primary text-primary-foreground grid place-items-center shadow shadow-primary/20">
              <img src="/circle-logo.png" alt="Circle" className="size-7 object-contain" />
            </div>
            <span className="font-semibold tracking-tight">Circle</span>
          </div>
          <div className="flex items-center gap-1">
            <CreateGroupDialog onCreated={(id) => navigate({ to: "/groups/$groupId", params: { groupId: id } })} />
            <NewChatDialog
              open={newOpen}
              onOpenChange={setNewOpen}
              onCreated={(id) => {
                setNewOpen(false);
                navigate({ to: "/chats/$conversationId", params: { conversationId: id } });
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-full">
                  <Avatar className="size-9">
                    <AvatarImage src={profile?.avatar_url ?? undefined} />
                    <AvatarFallback>{initials(profile?.name ?? "U")}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/profile"><UserIcon className="size-4 mr-2" /> Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings"><SettingsIcon className="size-4 mr-2" /> Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/install"><Smartphone className="size-4 mr-2" /> Install app</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {isDesktopDevice() ? (
                  <DropdownMenuItem onClick={async () => { await signOut(); navigate({ to: "/auth" }); toast.success("Signed out"); }}>
                    <LogOut className="size-4 mr-2" /> Sign out
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={(e) => { e.preventDefault(); toast.info("Sign out is only available on laptop or PC."); }}
                    className="opacity-60"
                  >
                    <LogOut className="size-4 mr-2" /> Sign out (PC only)
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="flex-1 flex flex-col min-h-0">
            {topTab === "chats" && (
              <>
            <div className="px-3 py-2">
              <div className="relative">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                 <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" className="h-11 rounded-2xl border-border/60 bg-background/70 pl-9" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Askify AI pinned entry — only after user has chatted with AI */}
              {hasUsedAskify() && ("askify ai".includes(search.toLowerCase()) || search === "") ? (
                <Link
                  to="/askify"
                  className="mx-2 flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-accent/60"
                  activeProps={{ className: "bg-accent" }}
                >
                  <div className="relative">
                    <Avatar className="size-12 ring-2 ring-primary/30">
                      <AvatarFallback className="bg-gradient-to-br from-violet-500 via-fuchsia-500 to-blue-500 text-white">
                        <Sparkles className="size-5" />
                      </AvatarFallback>
                    </Avatar>
                    <span className="absolute bottom-0 right-0 size-3 rounded-full bg-online ring-2 ring-sidebar" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold">Askify AI</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">Always on</span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">Ask me anything — powered by AI</p>
                  </div>
                </Link>
              ) : null}
              {filtered.length === 0 && !chatsLoaded && (
                <ChatListSkeleton />
              )}
              {filtered.length === 0 && chatsLoaded && (
                <div className="px-6 py-16 text-center">
                  <div className="mx-auto size-12 rounded-2xl bg-accent grid place-items-center mb-3">
                    <MessageCircle className="size-5 text-accent-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No conversations yet.<br />Add a friend, then tap + to start.</p>
                </div>
              )}
              {filtered.map((c) => {
                const key = c.isGroup ? `g:${c.groupId}` : `c:${c.conversationId}`;
                const u = !c.isGroup && c.conversationId ? unread[c.conversationId] ?? 0 : 0;
                const linkProps = c.isGroup
                  ? { to: "/groups/$groupId" as const, params: { groupId: c.groupId! } }
                  : { to: "/chats/$conversationId" as const, params: { conversationId: c.conversationId! } };
                return (
                  <Link
                    key={key}
                    {...linkProps}
                    className="mx-2 flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-accent/60"
                    activeProps={{ className: "bg-accent" }}
                  >
                    <div className="relative">
                      <Avatar className="size-12">
                        <AvatarImage src={c.avatarUrl ?? undefined} />
                        <AvatarFallback>
                          {c.isGroup ? <Users className="size-5" /> : initials(c.title)}
                        </AvatarFallback>
                      </Avatar>
                      {!c.isGroup && isOnline(c.otherUserId) && (
                        <span className="absolute bottom-0 right-0 size-3 rounded-full bg-online ring-2 ring-sidebar" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate", u > 0 ? "font-semibold" : "font-medium")}>
                          {c.title}
                          {c.isGroup && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">group</span>}
                        </span>
                        <span className={cn("text-[11px] shrink-0", u > 0 ? "text-primary font-medium" : "text-muted-foreground")}>
                          {formatChatListTime(c.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm truncate", u > 0 ? "text-foreground" : "text-muted-foreground")}>
                          {c.lastMessage?.content ?? (c.isGroup ? "New group — say hi 👋" : "Say hi 👋")}
                        </p>
                        {u > 0 && (
                          <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold grid place-items-center animate-scale-in">
                            {u > 99 ? "99+" : u}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
              </>
            )}
            {topTab === "status" && (
              <StatusTab />
            )}
            {topTab === "calls" && (
              <CallsTab />
            )}
        </div>

        {/* Bottom tab bar (WhatsApp style) */}
        <nav className="border-t border-border/70 bg-card/80 backdrop-blur-xl px-2 py-1.5 flex items-center justify-around">
          {([
            { key: "chats", label: "Chats", Icon: MessageSquare, badge: 0 },
            { key: "status", label: "Status", Icon: CircleDot, badge: 0 },
            { key: "calls", label: "Calls", Icon: PhoneCall, badge: missedCount },
          ] as const).map(({ key, label, Icon, badge }) => {
            const active = topTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTopTab(key);
                  if (key === "calls") void markMissedSeen();
                }}
                className={cn(
                  "relative flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[11px] font-medium transition-all duration-200",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className={cn(
                  "grid place-items-center size-9 rounded-2xl transition-all duration-200",
                  active ? "bg-primary/15 scale-105" : "bg-transparent",
                )}>
                  <Icon className="size-5" />
                  {badge > 0 && (
                    <span className="absolute top-0.5 right-[26%] min-w-[16px] h-4 px-1 rounded-full bg-online text-[10px] font-bold text-white grid place-items-center ring-2 ring-card">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className={cn("flex-1 flex flex-col overflow-hidden", showSidebarOnMobile ? "hidden md:flex" : "flex")}>
        {params.conversationId ? (
          <Outlet />
        ) : (
            <div className="flex-1 grid place-items-center bg-gradient-to-br from-background via-background to-accent/20 px-6">
             <div className="surface-glass text-center max-w-sm rounded-[2rem] px-8 py-10">
               <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-primary/10 text-primary">
                <MessageCircle className="size-7" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">Your messages live here</h2>
              <p className="text-sm text-muted-foreground mt-1">Select a conversation or start a new one to begin.</p>
            </div>
          </div>
        )}
      </main>
      {!params.conversationId && (
        <ChatFabStack
          open={fabOpen}
          onToggle={() => setFabOpen((v) => !v)}
          onAskify={() => { setFabOpen(false); navigate({ to: "/askify" }); }}
          onFriends={() => { setFabOpen(false); setFriendsOpen(true); }}
          onNewChat={() => { setFabOpen(false); setNewOpen(true); }}
          pendingRequests={pendingRequests}
        />
      )}
      <Sheet open={friendsOpen} onOpenChange={setFriendsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center gap-2"><Users className="size-5" /> Friends</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <FriendsPanel />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NewChatDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (b: boolean) => void; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [friends, setFriends] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    (async () => {
      const { data: fs } = await supabase
        .from("friendships")
        .select("*")
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
      const ids = (fs ?? []).map((f) => (f.user_a === user.id ? f.user_b : f.user_a));
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id,name,avatar_url,status").in("id", ids);
        setFriends((profs ?? []) as Profile[]);
      } else {
        setFriends([]);
      }
      setLoading(false);
    })();
    return () => { setQ(""); };
  }, [open, user]);

  const startChat = async (other: Profile) => {
    if (!user) return;
    const [a, b] = [user.id, other.id].sort();
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_a", a)
      .eq("user_b", b)
      .maybeSingle();
    if (existing) { onCreated(existing.id); return; }
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_a: a, user_b: b })
      .select("id")
      .single();
    if (error) { toast.error(error.message); return; }
    onCreated(data.id);
  };

  const filtered = friends.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="rounded-full"><Plus className="size-5" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a new chat</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your friends" className="pl-9 h-10 rounded-xl" />
        </div>
        <div className="max-h-72 overflow-y-auto -mx-2">
          {loading && <p className="text-sm text-muted-foreground px-4 py-3">Loading…</p>}
          {!loading && friends.length === 0 && (
            <p className="text-sm text-muted-foreground px-4 py-6 text-center">
              You don't have any friends yet. Open the Friends tab to add some.
            </p>
          )}
          {!loading && friends.length > 0 && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground px-4 py-3">No friend matches "{q}".</p>
          )}
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => startChat(p)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent/60 text-left"
            >
              <Avatar className="size-10">
                <AvatarImage src={p.avatar_url ?? undefined} />
                <AvatarFallback>{initials(p.name)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{p.status}</div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MobileBack() {
  const navigate = useNavigate();
  return (
    <Button size="icon" variant="ghost" className="md:hidden -ml-2" onClick={() => navigate({ to: "/chats" })}>
      <ArrowLeft className="size-5" />
    </Button>
  );
}

function ChatFabStack({
  open,
  onToggle,
  onAskify,
  onFriends,
  onNewChat,
  pendingRequests,
}: {
  open: boolean;
  onToggle: () => void;
  onAskify: () => void;
  onFriends: () => void;
  onNewChat: () => void;
  pendingRequests: number;
}) {
  return (
    <div className="fixed bottom-20 right-5 z-40 flex flex-col items-end gap-3">
      {/* Mini actions */}
      <div
        className={cn(
          "flex flex-col items-end gap-3 transition-all duration-200 origin-bottom-right",
          open ? "opacity-100 translate-y-0 scale-100" : "pointer-events-none opacity-0 translate-y-2 scale-95",
        )}
      >
        <button
          type="button"
          onClick={onAskify}
          aria-label="Open Askify AI"
          className="group flex items-center gap-2"
        >
          <span className="hidden sm:inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-card shadow-md border border-border/60">Askify AI</span>
          <span className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-blue-500 text-white shadow-lg shadow-violet-500/40 transition-transform group-hover:scale-110">
            <Sparkles className="size-5" />
          </span>
        </button>
        <button
          type="button"
          onClick={onFriends}
          aria-label="Open Friends"
          className="group relative flex items-center gap-2"
        >
          <span className="hidden sm:inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-card shadow-md border border-border/60">Friends</span>
          <span className="relative grid size-12 place-items-center rounded-full bg-card text-foreground border border-border shadow-lg transition-transform group-hover:scale-110">
            <Users className="size-5" />
            {pendingRequests > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center ring-2 ring-card">
                {pendingRequests > 9 ? "9+" : pendingRequests}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={onNewChat}
          aria-label="Start new chat"
          className="group flex items-center gap-2"
        >
          <span className="hidden sm:inline-block text-xs font-medium px-2.5 py-1 rounded-full bg-card shadow-md border border-border/60">New chat</span>
          <span className="grid size-12 place-items-center rounded-full bg-card text-foreground border border-border shadow-lg transition-transform group-hover:scale-110">
            <MessageSquare className="size-5" />
          </span>
        </button>
      </div>

      {/* Main FAB */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className={cn(
          "grid size-14 place-items-center rounded-full text-primary-foreground shadow-xl transition-all duration-200",
          "bg-gradient-to-br from-primary via-primary to-primary/80 shadow-primary/40",
          open ? "rotate-45 scale-95" : "hover:scale-110 active:scale-95",
        )}
      >
        {open ? <X className="size-6" /> : <Plus className="size-6" />}
      </button>
    </div>
  );
}
