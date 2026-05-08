// Server-only environment variable validation.
// Imported lazily by server functions/routes that need these vars.
// Never import this from client code (the `.server.ts` suffix blocks it).

const REQUIRED_SERVER_ENV = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "LOVABLE_API_KEY",
] as const;

export type RequiredServerEnv = (typeof REQUIRED_SERVER_ENV)[number];

export function getServerEnv(name: RequiredServerEnv): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[env] Missing required server env var: ${name}. ` +
        `Set it via 'wrangler secret put ${name}' (Cloudflare Workers) ` +
        `or in Lovable Cloud secrets.`,
    );
  }
  return v;
}

export function assertServerEnv(): { ok: true } | { ok: false; missing: string[] } {
  const missing = REQUIRED_SERVER_ENV.filter((k) => !process.env[k]);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
