import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/delete-account")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const token = authHeader.slice(7);

        // Verify token and get user id
        const verifier = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
        );
        const { data: userData, error: userErr } = await verifier.auth.getUser(token);
        if (userErr || !userData?.user) {
          return new Response(JSON.stringify({ error: "Invalid session" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const userId = userData.user.id;

        // Delete the auth user (cascades to profile via FK if configured; otherwise clean up)
        try {
          await supabaseAdmin.from("profiles").delete().eq("id", userId);
        } catch {
          // ignore
        }
        const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (delErr) {
          return new Response(JSON.stringify({ error: delErr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
