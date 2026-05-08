// Browser notification + permission helpers — safe in iframes/SSR.
let permissionPromise: Promise<NotificationPermission> | null = null;

function isInIframe() {
  try { return window.self !== window.top; } catch { return true; }
}

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window && !isInIframe();
}

export function getPermission(): NotificationPermission {
  if (!notificationsSupported()) return "denied";
  return Notification.permission;
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  if (!permissionPromise) {
    permissionPromise = Notification.requestPermission().finally(() => { permissionPromise = null; });
  }
  return permissionPromise;
}

type NotifyOpts = {
  title: string;
  body?: string;
  icon?: string;
  tag?: string;
  requireInteraction?: boolean;
  onClick?: () => void;
  silent?: boolean;
};

/**
 * Show a notification only when the page is hidden / blurred.
 * If the page is visible, returns null and the caller should rely on the
 * in-app toast instead.
 */
export function notifyIfHidden(opts: NotifyOpts): Notification | null {
  if (!notificationsSupported() || Notification.permission !== "granted") return null;
  if (typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()) return null;
  return rawNotify(opts);
}

export function notifyAlways(opts: NotifyOpts): Notification | null {
  if (!notificationsSupported() || Notification.permission !== "granted") return null;
  return rawNotify(opts);
}

function rawNotify(opts: NotifyOpts) {
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon ?? "/icon-192.png",
      badge: "/icon-192.png",
      tag: opts.tag,
      requireInteraction: opts.requireInteraction,
      silent: opts.silent,
    });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      try { opts.onClick?.(); } catch { /* ignore */ }
      n.close();
    };
    return n;
  } catch {
    return null;
  }
}

/** Set browser tab title to include unread count. */
export function setTitleBadge(count: number, base = "Circle — Real-time Messaging") {
  if (typeof document === "undefined") return;
  document.title = count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
}
