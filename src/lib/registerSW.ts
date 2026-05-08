// Service Worker registration — runs only on production hosts (never in
// Lovable preview iframes). Also captures and stores the deferred
// `beforeinstallprompt` event for the /install page.

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

declare global {
  interface Window {
    __circleDeferredPrompt?: BIPEvent | null;
    __circleSWRegistration?: ServiceWorkerRegistration | null;
  }
}

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isPreviewHost(): boolean {
  const h = window.location.hostname;
  return h.includes("id-preview--") || h.includes("lovableproject.com") || h === "localhost" || h === "127.0.0.1";
}

export function registerServiceWorker() {
  if (typeof window === "undefined") return;

  // Capture install prompt regardless (safe in all contexts that support it)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__circleDeferredPrompt = e as BIPEvent;
    window.dispatchEvent(new CustomEvent("circle:install-available"));
  });
  window.addEventListener("appinstalled", () => {
    window.__circleDeferredPrompt = null;
    window.dispatchEvent(new CustomEvent("circle:installed"));
  });

  if (!("serviceWorker" in navigator)) return;

  // CRITICAL: skip + cleanup in iframes / preview / dev
  if (isInIframe() || isPreviewHost()) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
    return;
  }

  // Listen for click-to-navigate messages from the SW
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "NAVIGATE" && typeof event.data.url === "string") {
      window.location.assign(event.data.url);
    }
    if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGE") {
      window.dispatchEvent(new CustomEvent("circle:push-subscription-change"));
    }
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { type: "classic", scope: "/" })
      .then((reg) => {
        window.__circleSWRegistration = reg;
        // Auto-update on new SW
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              sw.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => console.warn("[sw] registration failed", err));
  });
}
