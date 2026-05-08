import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Profile = {
  id: string;
  name: string;
  avatar_url: string | null;
  date_of_birth: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  last_seen: string;
};

type AuthCtx = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);


export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    setProfile((data as Profile) ?? null);
  };

  useEffect(() => {
    let active = true;

    const applySession = (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        // Load profile for any authenticated user (email-confirmed, phone, OAuth)
        void loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }
      setLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    void supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const stamp = () => new Date().toISOString();
    const setOnline = () => supabase.from("profiles").update({ status: "online", last_seen: stamp() }).eq("id", userId);
    const setOffline = () => supabase.from("profiles").update({ status: "offline", last_seen: stamp() }).eq("id", userId);

    void setOnline();
    const interval = setInterval(() => void setOnline(), 30000);
    const onHide = () => {
      if (document.visibilityState === "hidden") void setOffline();
    };

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", setOffline);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", setOffline);
      void setOffline();
    };
  }, [user?.id]);

  return (
    <Ctx.Provider
      value={{
        session,
        user,
        profile,
        loading,
        signOut: async () => {
          try {
            if (user) {
              await supabase.from("profiles").update({ status: "offline", last_seen: new Date().toISOString() }).eq("id", user.id);
            }
          } catch {
          } finally {
            await supabase.auth.signOut();
          }
        },
        refreshProfile: async () => {
          if (user) {
            await loadProfile(user.id);
          }
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
