/// <reference lib="webworker" />
// Custom service worker for Circle.
// Combines Workbox precaching (via vite-plugin-pwa injectManifest) with
// runtime caching for fonts/images/assets, an offline fallback, and full
// Web Push (RFC 8291) handling with notification click routing.

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, setCatchHandler, NavigationRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// --- Lifecycle: take over immediately on update ---
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// --- Precache the build manifest injected by Workbox ---
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

const OFFLINE_URL = "/offline.html";

// --- Runtime caching ---

// Google Fonts CSS — refresh in background
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({ cacheName: "google-fonts-css" }),
);

// Google Fonts files — long cache
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "google-fonts-webfonts",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
);

// Images
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "images",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// JS/CSS — fast updates
registerRoute(
  ({ request }) => request.destination === "script" || request.destination === "style" || request.destination === "worker",
  new StaleWhileRevalidate({
    cacheName: "static-resources",
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
);

// --- Navigation: NetworkFirst with offline fallback, BUT exclude OAuth & API ---
const navigationRoute = new NavigationRoute(
  new NetworkFirst({
    cacheName: "pages",
    networkTimeoutSeconds: 4,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  }),
  {
    denylist: [
      /^\/~oauth/, // OAuth callbacks
      /^\/api\//,  // API endpoints
      /^\/_/,      // Internal framework routes
    ],
  },
);
registerRoute(navigationRoute);

// Catch-all: serve offline page on navigation failures
setCatchHandler(async ({ request }) => {
  if (request.destination === "document") {
    const cache = await caches.open("pages");
    const cached = await cache.match(OFFLINE_URL);
    if (cached) return cached;
    return Response.error();
  }
  return Response.error();
});

// --- Web Push (RFC 8291) ---
type PushPayload = {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  silent?: boolean;
  actions?: Array<{ action: string; title: string; icon?: string }>;
};

self.addEventListener("push", (event: PushEvent) => {
  let payload: PushPayload = {};
  if (event.data) {
    try {
      payload = event.data.json() as PushPayload;
    } catch {
      payload = { title: "Circle", body: event.data.text() };
    }
  }

  const title = payload.title || "Circle";
  const options: NotificationOptions & { actions?: Array<{ action: string; title: string; icon?: string }> } = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    tag: payload.tag,
    requireInteraction: payload.requireInteraction,
    silent: payload.silent,
    data: { url: payload.url || "/chats", ...(payload.data || {}) },
    actions: payload.actions as Array<{ action: string; title: string; icon?: string }> | undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl = (event.notification.data?.url as string) || "/chats";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an existing tab if open
      for (const client of allClients) {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          await (client as WindowClient).focus();
          (client as WindowClient).postMessage({ type: "NAVIGATE", url: targetUrl });
          return;
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event: Event) => {
  // Notify clients so they can re-subscribe with the same VAPID key
  (event as ExtendableEvent).waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      allClients.forEach((c) => c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGE" }));
    })(),
  );
});

// Allow pages to skip waiting on update
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
