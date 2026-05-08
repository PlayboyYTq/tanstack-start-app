import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Apple, Smartphone, Monitor, Download, Bell, Camera, Mic, Check, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { useAuth } from "@/lib/auth";
import { isSubscribed, subscribeToPush } from "@/lib/push";

export const Route = createFileRoute("/install")({
  component: InstallPage,
  head: () => ({
    meta: [
      { title: "Install Circle — Add to your phone" },
      { name: "description", content: "Install Circle on Android, iOS, or desktop. Enable push notifications, camera, and microphone for the full experience." },
    ],
  }),
});

function InstallPage() {
  const { user } = useAuth();
  const { platform, isInstallable, isInstalled, installPWA } = usePWAInstall();
  const [pushOn, setPushOn] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => { void isSubscribed().then(setPushOn); }, []);

  const install = async () => {
    const outcome = await installPWA();
    if (outcome === "accepted") toast.success("Installing Circle…");
    else if (outcome === "unavailable") toast.info("Open Circle in Chrome on Android (or use the share menu on iOS) to install.");
  };

  const requestPerms = async () => {
    setWorking(true);
    try {
      // Notifications + push subscribe
      if ("Notification" in window) {
        const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        if (perm === "granted" && user) {
          const ok = await subscribeToPush(user.id);
          setPushOn(ok);
        }
      }
      // Camera + mic
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch { /* user may have denied; that's ok */ }
      toast.success("Permissions configured.");
    } catch {
      toast.error("Permission request failed.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-8 sm:py-14 bg-[radial-gradient(circle_at_20%_0%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_45%),radial-gradient(circle_at_80%_100%,color-mix(in_oklab,var(--color-accent)_25%,transparent),transparent_45%)]">
      <div className="mx-auto w-full max-w-3xl">
        <Link to="/chats" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to chats
        </Link>

        <header className="mt-6 flex flex-col items-center text-center">
          <img src="/icon-512.png" alt="Circle app icon" width={96} height={96} className="size-24 rounded-3xl shadow-xl" />
          <h1 className="mt-5 text-3xl sm:text-4xl font-bold tracking-tight">Install Circle</h1>
          <p className="mt-2 max-w-lg text-sm sm:text-base text-muted-foreground">
            Add Circle to your home screen for instant access, push notifications, and a full-screen, app-like experience.
          </p>
          {isInstalled && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
              <Check className="size-4" /> Circle is installed on this device
            </div>
          )}
        </header>

        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          {/* Android */}
          <div className={`surface-glass rounded-3xl p-6 ${platform === "android" ? "ring-2 ring-primary/40" : ""}`}>
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Smartphone className="size-5" /></div>
              <h2 className="text-lg font-semibold">Android</h2>
              {platform === "android" && <span className="ml-auto text-xs font-semibold text-primary">Detected</span>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Tap install in Chrome, Edge, or Brave. {isInstalled && "Already installed."}
            </p>
            <Button onClick={install} disabled={isInstalled} className="mt-4 w-full" size="lg">
              {isInstalled ? <><Check className="size-4 mr-2" /> Installed</> : <><Download className="size-4 mr-2" /> {isInstallable ? "Install App" : "Install"}</>}
            </Button>
            {!isInstallable && !isInstalled && <p className="mt-2 text-xs text-muted-foreground">If nothing happens, open the browser menu and choose "Install app".</p>}
          </div>

          {/* iOS */}
          <div className={`surface-glass rounded-3xl p-6 ${platform === "ios" ? "ring-2 ring-primary/40" : ""}`}>
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Apple className="size-5" /></div>
              <h2 className="text-lg font-semibold">iPhone / iPad</h2>
              {platform === "ios" && <span className="ml-auto text-xs font-semibold text-primary">Detected</span>}
            </div>
            <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2"><span className="font-semibold text-foreground">1.</span> Open Circle in <strong className="text-foreground">Safari</strong>.</li>
              <li className="flex gap-2"><span className="font-semibold text-foreground">2.</span> Tap the <Share2 className="inline size-4" /> Share button.</li>
              <li className="flex gap-2"><span className="font-semibold text-foreground">3.</span> Choose <strong className="text-foreground">Add to Home Screen</strong>.</li>
            </ol>
          </div>

          {/* Desktop */}
          <div className={`surface-glass rounded-3xl p-6 sm:col-span-2 ${platform === "desktop" ? "ring-2 ring-primary/40" : ""}`}>
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Monitor className="size-5" /></div>
              <h2 className="text-lg font-semibold">Desktop</h2>
              {platform === "desktop" && <span className="ml-auto text-xs font-semibold text-primary">Detected</span>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Look for the <Download className="inline size-4" /> install icon at the right side of your address bar in Chrome, Edge, or Brave — or use the install button below.
            </p>
            <Button onClick={install} disabled={isInstalled} variant="secondary" className="mt-4">
              <Download className="size-4 mr-2" /> Install on this computer
            </Button>
          </div>
        </section>

        <section className="mt-6 surface-glass rounded-3xl p-6">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="size-5" /></div>
            <div>
              <h3 className="text-lg font-semibold">Grant permissions</h3>
              <p className="text-sm text-muted-foreground">Enable notifications and call access in one tap.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <PermPill icon={<Bell className="size-4" />} label="Notifications" on={pushOn} />
            <PermPill icon={<Mic className="size-4" />} label="Microphone" />
            <PermPill icon={<Camera className="size-4" />} label="Camera" />
          </div>
          <Button onClick={requestPerms} disabled={working} className="mt-4 w-full sm:w-auto" size="lg">
            {working ? "Requesting…" : "Grant permissions"}
          </Button>
          {!user && <p className="mt-2 text-xs text-muted-foreground">Sign in to enable push notifications across devices.</p>}
        </section>

      </div>
    </div>
  );
}

function PermPill({ icon, label, on }: { icon: React.ReactNode; label: string; on?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm ${on ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card/40"}`}>
      <span className="text-primary">{icon}</span>
      <span className="font-medium">{label}</span>
      {on && <Check className="size-4 ml-auto" />}
    </div>
  );
}
