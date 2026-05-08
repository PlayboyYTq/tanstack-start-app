// Force-refresh the PWA: unregister service workers, clear caches, and hard reload.
// Used by the "Update App" button in Settings so users always see the newest build.
export async function forceUpdateApp(): Promise<void> {
  try {
    if (typeof window === "undefined") return;

    // 1. Tell any active SW to skip waiting (in case a new one is installed but waiting)
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map(async (reg) => {
          try {
            reg.waiting?.postMessage({ type: "SKIP_WAITING" });
            await reg.update();
          } catch {
            /* ignore */
          }
        }),
      );
      // Then unregister so next load fetches a fresh SW
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }

    // 2. Wipe all CacheStorage entries (HTML/JS/CSS asset caches)
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }

    // 3. Bust HTTP cache by appending a cache-buster + reload from network
    const url = new URL(window.location.href);
    url.searchParams.set("_v", Date.now().toString());
    window.location.replace(url.toString());
  } catch {
    // Last-ditch fallback
    window.location.reload();
  }
}
