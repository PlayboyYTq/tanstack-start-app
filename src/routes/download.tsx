import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Smartphone } from "lucide-react";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { toast } from "sonner";

export const Route = createFileRoute("/download")({
  component: DownloadPage,
  head: () => ({
    meta: [
      { title: "Install Circle — Get the App" },
      { name: "description", content: "Install Circle on your phone for instant chat, calls, and notifications." },
    ],
  }),
});

function DownloadPage() {
  const navigate = useNavigate();
  const { isInstallable, isInstalled, installPWA } = usePWAInstall();

  // Auto-trigger install when possible
  useEffect(() => {
    if (isInstalled) return;
    if (!isInstallable) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      const outcome = await installPWA();
      if (outcome === "accepted") toast.success("Installing Circle…");
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isInstallable, isInstalled, installPWA]);

  const install = async () => {
    const outcome = await installPWA();
    if (outcome === "accepted") {
      toast.success("Installing Circle…");
    } else if (outcome === "unavailable") {
      toast.info("Open the Install page for full instructions.");
      navigate({ to: "/install" });
    }
  };

  return (
    <div className="min-h-dvh px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <Link to="/chats" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to chats
        </Link>

        <div className="mt-10 flex flex-col items-center text-center">
          <img src="/icon-512.png" alt="Circle" width={120} height={120} className="size-28 rounded-[2rem] shadow-2xl" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Get Circle</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Install Circle on your device for instant access, push notifications, and a full app-like experience.
          </p>

          <Button onClick={install} size="lg" className="mt-8 h-12 w-full text-base">
            {isInstalled ? (
              <><Smartphone className="size-5 mr-2" /> Already installed</>
            ) : (
              <><Download className="size-5 mr-2" /> Install Circle</>
            )}
          </Button>

          <Button asChild variant="ghost" className="mt-2 w-full">
            <Link to="/install">Other install options</Link>
          </Button>

          <p className="mt-6 text-xs text-muted-foreground">
            Tip: On iPhone, open in Safari → Share → Add to Home Screen.
          </p>
        </div>
      </div>
    </div>
  );
}
