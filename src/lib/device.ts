// Detect whether we're running on a laptop / desktop browser as opposed to a
// phone or tablet. Used by the sign-out flow which should only fully log the
// user out on desktops — on mobile we keep the session alive so the user
// doesn't lose their chat history when they accidentally tap "Sign out".
export function isDesktopDevice(): boolean {
  if (typeof window === "undefined") return true;
  const ua = navigator.userAgent || "";
  // Treat anything matching common mobile/tablet UA tokens as non-desktop.
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i;
  if (mobileRegex.test(ua)) return false;
  // Coarse pointer (touch primary) typically indicates a phone/tablet.
  if (window.matchMedia?.("(pointer: coarse)").matches && window.matchMedia?.("(max-width: 1024px)").matches) {
    return false;
  }
  return true;
}
