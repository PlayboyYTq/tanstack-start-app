import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Msg = { role: "user" | "assistant" | "system"; content: string };

export const Route = createFileRoute("/api/askify")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const apiKey = process.env.GROQ_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "GROQ_API_KEY not configured" }), {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }
          const body = (await request.json()) as { messages?: Msg[] };
          const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
          if (messages.length === 0) {
            return new Response(JSON.stringify({ error: "messages required" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [
                {
                  role: "system",
                  content:
                    "You are Askify AI, a friendly, concise assistant inside the Circle messaging app. Keep replies clear and helpful. Use markdown sparingly.",
                },
                ...messages,
              ],
              temperature: 0.7,
              max_tokens: 1024,
            }),
          });

          if (!resp.ok) {
            const t = await resp.text();
            console.error("Groq error", resp.status, t);
            return new Response(
              JSON.stringify({ error: `AI service error (${resp.status})` }),
              { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } },
            );
          }

          const json = (await resp.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const content = json.choices?.[0]?.message?.content ?? "";
          return new Response(JSON.stringify({ content }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        } catch (e) {
          console.error("askify error", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
            { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }
      },
    },
  },
});
