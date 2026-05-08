import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, Bell, Moon, UserCog, ShieldOff, RefreshCw,
  Volume2, Eye, Languages, LogOut, Trash2, Smartphone, Info,
} from "lucide-react";
import { ensureNotificationPermission } from "@/lib/notifications";
import { toast } from "sonner";
import { AppLoader } from "@/components/AppLoader";
import { forceUpdateApp } from "@/lib/updateApp";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const NOTIF_KEY = "circle:notifications-enabled";
const SOUND_KEY = "circle:sound-enabled";
const PREVIEW_KEY = "circle:message-preview";
const ENTER_SEND_KEY = "circle:enter-to-send";

function readBool(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  if (v === null) return fallback;
  return v === "true";
}
function writeBool(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value ? "true" : "false");
}

function SettingsPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { theme, setTheme } = useTheme();
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [enterToSend, setEnterToSend] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const onUpdateApp = async () => {
    if (updating) return;
    setUpdating(true);
    toast.success("Updating Circle to the latest version…");
    await forceUpdateApp();
  };

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(NOTIF_KEY);
    const permission = typeof Notification !== "undefined" ? Notification.permission : "default";
    setNotifEnabled(stored === "true" && permission === "granted");
    setSoundEnabled(readBool(SOUND_KEY, true));
    setPreviewEnabled(readBool(PREVIEW_KEY, true));
    setEnterToSend(readBool(ENTER_SEND_KEY, true));
  }, []);

  const onToggleNotif = async (value: boolean) => {
    if (value) {
      const permission = await ensureNotificationPermission();
      if (permission !== "granted") {
        toast.error("Notification permission was denied in your browser.");
        return;
      }
      writeBool(NOTIF_KEY, true);
      setNotifEnabled(true);
      toast.success("Notifications enabled");
    } else {
      writeBool(NOTIF_KEY, false);
      setNotifEnabled(false);
      toast.success("Notifications muted");
    }
  };

  const onToggleSound = (v: boolean) => { writeBool(SOUND_KEY, v); setSoundEnabled(v); };
  const onTogglePreview = (v: boolean) => { writeBool(PREVIEW_KEY, v); setPreviewEnabled(v); };
  const onToggleEnter = (v: boolean) => { writeBool(ENTER_SEND_KEY, v); setEnterToSend(v); };

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      toast.success("Signed out");
      navigate({ to: "/auth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sign out");
    } finally {
      setSigningOut(false);
    }
  };

  const onClearCache = async () => {
    try {
      const keep = new Set(["circle:theme"]);
      Object.keys(localStorage).filter((k) => !keep.has(k)).forEach((k) => localStorage.removeItem(k));
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
      toast.success("Local cache cleared");
    } catch {
      toast.error("Couldn't clear cache");
    }
  };

  if (loading) return <AppLoader title="Loading settings" detail="Just a moment…" />;
  if (!user) return <AppLoader title="Redirecting to sign in" detail="Please wait…" />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-accent/30">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-6 pb-20">
        <Link to="/chats" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to chats
        </Link>

        <Card className="p-6 md:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Customize Circle to your preference.</p>
        </Card>

        <Card className="p-6 md:p-8 border-primary/30 bg-primary/5">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <RefreshCw className={`size-5 text-primary ${updating ? "animate-spin" : ""}`} /> App version
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Not seeing new features? Force-refresh Circle to download the latest version.
          </p>
          <div className="mt-5">
            <Button onClick={onUpdateApp} disabled={updating} className="rounded-xl">
              <RefreshCw className={`size-4 mr-2 ${updating ? "animate-spin" : ""}`} />
              {updating ? "Updating…" : "Update App"}
            </Button>
          </div>
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <Bell className="size-5 text-primary" /> Notifications
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Manage alerts when Circle is in the background.</p>
          <div className="mt-5 space-y-4">
            <Row>
              <Label htmlFor="notif" className="text-sm">Enable browser notifications</Label>
              <Switch id="notif" checked={notifEnabled} onCheckedChange={onToggleNotif} />
            </Row>
            <Row>
              <Label htmlFor="preview" className="text-sm">Show message preview</Label>
              <Switch id="preview" checked={previewEnabled} onCheckedChange={onTogglePreview} />
            </Row>
            <Row>
              <Label htmlFor="sound" className="text-sm inline-flex items-center gap-2">
                <Volume2 className="size-4 text-primary" /> Notification sound
              </Label>
              <Switch id="sound" checked={soundEnabled} onCheckedChange={onToggleSound} />
            </Row>
          </div>
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <Moon className="size-5 text-primary" /> Appearance
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Switch between a light and dark interface.</p>
          <div className="mt-5 space-y-4">
            <Row>
              <Label htmlFor="dark" className="text-sm">Dark mode</Label>
              <Switch id="dark" checked={theme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
            </Row>
          </div>
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <Eye className="size-5 text-primary" /> Chat
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Tweak how messaging behaves.</p>
          <div className="mt-5 space-y-4">
            <Row>
              <Label htmlFor="enter" className="text-sm">Press Enter to send</Label>
              <Switch id="enter" checked={enterToSend} onCheckedChange={onToggleEnter} />
            </Row>
          </div>
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <Languages className="size-5 text-primary" /> Language
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Circle is currently available in English. More languages coming soon.</p>
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <UserCog className="size-5 text-primary" /> Profile
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Update your name, avatar, phone number, or manage blocked users.</p>
          <div className="mt-5 flex flex-col sm:flex-row gap-3">
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/profile"><UserCog className="size-4 mr-2" /> Edit profile</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/profile"><ShieldOff className="size-4 mr-2" /> Blocked users</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <Smartphone className="size-5 text-primary" /> Install
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Install Circle on your phone or computer for the full app experience.</p>
          <div className="mt-5">
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/install"><Smartphone className="size-4 mr-2" /> Install Circle</Link>
            </Button>
          </div>
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <Trash2 className="size-5 text-primary" /> Storage
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Clear cached data on this device. Your messages stay on the server.</p>
          <div className="mt-5">
            <Button onClick={onClearCache} variant="outline" className="rounded-xl">
              <Trash2 className="size-4 mr-2" /> Clear local cache
            </Button>
          </div>
        </Card>

        <Card className="p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2">
            <Info className="size-5 text-primary" /> About
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Circle — modern minimal real-time chat.</p>
          <p className="text-xs text-muted-foreground mt-2">Version 1.0.0</p>
        </Card>

        <Card className="p-6 md:p-8 border-destructive/30">
          <h2 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2 text-destructive">
            <LogOut className="size-5" /> Account
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Sign out of Circle on this device.</p>
          <div className="mt-5">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="rounded-xl" disabled={signingOut}>
                  <LogOut className="size-4 mr-2" /> Sign out
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sign out of Circle?</AlertDialogTitle>
                  <AlertDialogDescription>You'll need to sign in again to access your chats on this device.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onSignOut} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Sign out</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4">{children}</div>;
}
