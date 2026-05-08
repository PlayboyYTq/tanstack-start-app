// Helper to trigger a Web Push notification to a specific user via /api/push/send.
// Best-effort: never throws into UI flow.
import { supabase } from "@/integrations/supabase/client";

type SendPushOpts = {
  userId: string;
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
};

export async function sendPush(opts: SendPushOpts): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: opts.userId,
        title: opts.title,
        body: opts.body,
        url: opts.url,
        tag: opts.tag,
        requireInteraction: opts.requireInteraction,
        icon: "/icon-192.png",
        data: opts.data,
      }),
      keepalive: true,
    });
  } catch {
    // best-effort
  }
}

export async function sendPushToMany(userIds: string[], opts: Omit<SendPushOpts, "userId">) {
  await Promise.all(userIds.map((id) => sendPush({ ...opts, userId: id })));
}
