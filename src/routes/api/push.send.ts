// Server route to send a Web Push notification.
// Authenticated via the caller's Supabase session — only logged-in users may
// trigger pushes to other users (e.g. on message send / incoming call).
//
// POST /api/push/send
// Body: { user_id: string, title: string, body?: string, url?: string, tag?: string,
//         icon?: string, requireInteraction?: boolean, data?: object }

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { z } from "zod";

const PayloadSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().max(500).optional(),
  url: z.string().max(500).optional(),
  tag: z.string().max(100).optional(),
  icon: z.string().max(500).optional(),
  badge: z.string().max(500).optional(),
  requireInteraction: z.boolean().optional(),
  silent: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const VAPID_PUBLIC_KEY =
  "BMD15QAUqqB-BlyiCm23ctgn_ONp574P48gwX6p3X6GTcT4I8YGVTIWnH6gk9oRkALq1Fzca57BGWjjDGrD0nyg";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/push/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // --- Auth: require a valid Supabase JWT ---
        const authHeader = request.headers.get("authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!token) return jsonResponse({ error: "Missing Authorization header" }, 401);

        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
        const vapidSubject = process.env.VAPID_SUBJECT || "mailto:support@circle.app";

        if (!supabaseUrl || !anonKey || !serviceKey || !vapidPrivate) {
          return jsonResponse({ error: "Server not configured" }, 500);
        }

        // Verify the caller
        const authClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userErr } = await authClient.auth.getUser();
        if (userErr || !userData.user) return jsonResponse({ error: "Invalid session" }, 401);

        // --- Validate body ---
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return jsonResponse({ error: "Invalid JSON" }, 400);
        }
        const parsed = PayloadSchema.safeParse(raw);
        if (!parsed.success) return jsonResponse({ error: "Invalid payload", issues: parsed.error.issues }, 400);
        const payload = parsed.data;

        // Don't push to yourself (UI handles in-app notifications)
        if (payload.user_id === userData.user.id) {
          return jsonResponse({ ok: true, skipped: "self" });
        }

        // --- Load recipient's subscriptions (admin client bypasses RLS) ---
        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: subs, error: subsErr } = await admin
          .from("push_subscriptions")
          .select("endpoint,p256dh,auth")
          .eq("user_id", payload.user_id);
        if (subsErr) return jsonResponse({ error: "Subscription lookup failed" }, 500);
        if (!subs || subs.length === 0) return jsonResponse({ ok: true, sent: 0 });

        // --- Configure web-push ---
        webpush.setVapidDetails(vapidSubject, VAPID_PUBLIC_KEY, vapidPrivate);

        const notification = JSON.stringify({
          title: payload.title,
          body: payload.body,
          url: payload.url,
          tag: payload.tag,
          icon: payload.icon,
          badge: payload.badge,
          requireInteraction: payload.requireInteraction,
          silent: payload.silent,
          data: payload.data,
        });

        const results = await Promise.allSettled(
          subs.map((s) =>
            webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              notification,
              { TTL: 60 },
            ),
          ),
        );

        // Cleanup expired endpoints (404/410)
        const expired: string[] = [];
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            const err = r.reason as { statusCode?: number };
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              expired.push(subs[i].endpoint);
            } else {
              console.warn("[push] send error", err);
            }
          }
        });
        if (expired.length) {
          await admin.from("push_subscriptions").delete().in("endpoint", expired);
        }

        const sent = results.filter((r) => r.status === "fulfilled").length;
        return jsonResponse({ ok: true, sent, failed: results.length - sent, removed: expired.length });
      },
    },
  },
});
