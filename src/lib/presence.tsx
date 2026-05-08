import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { RealtimeChannel } from "@supabase/supabase-js";

type PresenceCtx = {
  /** Set of user IDs currently online (across the whole app). */
  onlineIds: Set<string>;
  isOnline: (userId: string | null | undefined) => boolean;
};

const Ctx = createContext<PresenceCtx | undefined>(undefined);

/**
 * Global presence using Supabase Realtime "presence" feature.
 * Every signed-in client joins a single shared channel and tracks itself.
 * The set of online user IDs is broadcast in real time to everyone.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!user) {
      setOnlineIds(new Set());
      return;
    }
    let disposed = false;

    const channel = supabase.channel("presence:global", {
      config: { presence: { key: user.id } },
    });
    channelRef.current = channel;

    const sync = () => {
      if (disposed) return;
      const state = channel.presenceState() as Record<string, unknown[]>;
      setOnlineIds(new Set(Object.keys(state)));
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ at: new Date().toISOString() });
        }
      });

    return () => {
      disposed = true;
      try { void channel.untrack(); } catch { /* ignore */ }
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user?.id]);

  const value = useMemo<PresenceCtx>(() => ({
    onlineIds,
    isOnline: (id) => !!id && onlineIds.has(id),
  }), [onlineIds]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePresence() {
  const c = useContext(Ctx);
  if (!c) return { onlineIds: new Set<string>(), isOnline: () => false } as PresenceCtx;
  return c;
}
