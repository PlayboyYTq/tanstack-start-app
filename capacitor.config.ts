import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor config for building Pulse as a native Android (and iOS) app.
// The WebView loads the published PWA, so the web app stays the source of truth.
//
// Quick start:
//   npm run build
//   npx cap add android
//   npx cap add ios          # macOS only
//   npx cap sync
//   npx cap open android     # opens Android Studio
//   npx cap open ios         # opens Xcode
//
// See BUILD_MOBILE_APP.md for full step-by-step build & signing instructions.

const PUBLISHED_URL = "https://pulse-app-connect.lovable.app";

const config: CapacitorConfig = {
  appId: "app.lovable.pulse",
  appName: "Pulse",
  webDir: "dist",
  // Loads the hosted PWA inside the WebView (hot-reload to your live deploy).
  // Comment out the `server` block to ship a fully bundled offline-capable app.
  server: {
    url: PUBLISHED_URL,
    cleartext: false,
    androidScheme: "https",
    iosScheme: "https",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    minWebViewVersion: 55,
    overrideUserAgent: undefined,
    appendUserAgent: "PulseAndroid/1.0",
    backgroundColor: "#0F172A",
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#0F172A",
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: true,
    appendUserAgent: "PulseiOS/1.0",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#0F172A",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
