# Cloudflare Workers Deployment

This app runs on **Cloudflare Workers** via TanStack Start + `@cloudflare/vite-plugin`. It is **not** a static site — server functions require a Workers runtime. Cloudflare Pages is not suitable.

## One-time setup

1. Install Wrangler & login:
   ```bash
   npm install
   npx wrangler login
   ```

2. Set all required secrets on the Worker:
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT
   npx wrangler secret put LOVABLE_API_KEY
   ```

3. Add **build-time** (client-bundled) vars to a local `.env` (already auto-managed in Lovable):
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_PUBLISHABLE_KEY=...
   VITE_SUPABASE_PROJECT_ID=...
   VITE_VAPID_PUBLIC_KEY=...   # for browser push subscribe
   ```

## Deploy

```bash
npm run build      # vite build → produces Worker bundle
npm run deploy     # wrangler deploy
```

Dry-run (verify bundle without uploading):
```bash
npm run deploy:dryrun
```

## Required environment variables

| Name | Scope | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | client + server | Supabase REST endpoint |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client + server | Public anon key |
| `VITE_SUPABASE_PROJECT_ID` | client | Project identifier |
| `SUPABASE_URL` | server | Same URL, server context |
| `SUPABASE_PUBLISHABLE_KEY` | server | Anon key, server context |
| `SUPABASE_SERVICE_ROLE_KEY` | server **secret** | Admin operations, push targeting |
| `VAPID_PUBLIC_KEY` | server | Web Push (VAPID) |
| `VAPID_PRIVATE_KEY` | server **secret** | Web Push signing |
| `VAPID_SUBJECT` | server | mailto: contact for push |
| `LOVABLE_API_KEY` | server **secret** | Lovable AI Gateway (Askify) |

## Smoke test after deploy

After `wrangler deploy` returns a URL (e.g. `https://circle.<account>.workers.dev`):

```bash
BASE="https://YOUR-WORKER.workers.dev"
curl -I "$BASE/"                       # 200 → SSR shell renders
curl -I "$BASE/auth"                   # 200 → auth page
curl -I "$BASE/manifest.webmanifest"   # 200 → PWA manifest served
curl -I "$BASE/sw.js"                  # 200 → service worker served
curl -I "$BASE/icon-192.png"           # 200 → PWA icon
```

Then in the browser, sign in and verify:
- **Auth**: email/password sign-in + Google OAuth round-trip
- **Chat**: send a DM, verify it appears in real time on a second device
- **Statuses**: post a text/image/video status
- **Calls**: start a call from contact → ringing on callee
- **Uploads**: send an image/video attachment in a chat
- **AI**: open Askify, send a message, get a response
- **Push**: install PWA on phone → close app → send DM from another device → notification fires

## Hosting flow summary

```
local edit → npm run build → npm run deploy → Cloudflare Workers
                                            ↘ Lovable Cloud (Supabase) for DB/auth/storage/realtime
                                            ↘ Lovable AI Gateway for Askify
                                            ↘ Web Push (VAPID) directly from Worker
```

## Final answers

- **Final deploy command**: `npm run deploy` (= `wrangler deploy`)
- **Final build command**: `npm run build`
- **Hosting**: Cloudflare Workers (single Worker serves SSR + server functions + static assets)
- **Package manager**: `npm` for Cloudflare CI; the Lovable editor itself uses `bun` internally — both produce equivalent `node_modules`. Do **not** delete `bun.lockb` from the repo if you want the Lovable editor to keep working; it's harmless for `npm install` (npm ignores it).
