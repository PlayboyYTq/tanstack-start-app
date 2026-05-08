# Building Pulse as a native mobile app

Pulse runs as a Progressive Web App **and** can be packaged as a native
Android (APK / AAB) and iOS app via [Capacitor](https://capacitorjs.com/).
The native shell wraps a WebView pointing at your published Pulse domain,
so all features (chat, calls, push, install) stay in sync with the web build.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | LTS recommended |
| npm / bun | latest | bun preferred |
| Android Studio | Hedgehog (2023.1) or newer | for APK / AAB |
| Java JDK | 17 | bundled with Android Studio |
| Xcode | 15+ | iOS only, macOS required |
| CocoaPods | 1.14+ | iOS only — `sudo gem install cocoapods` |

---

## 2. One-time setup

```bash
# Install dependencies
npm install

# Build the web app (output: dist/)
npm run build

# Add the native Android project
npx cap add android

# (macOS only) add the native iOS project
npx cap add ios

# Sync the web build + plugins into the native projects
npx cap sync
```

The Android project lives in `android/`, iOS in `ios/`. Both folders are
generated — do not commit them in your day-to-day workflow unless you
intentionally customize them.

---

## 3. Android: Required AndroidManifest.xml permissions

Open `android/app/src/main/AndroidManifest.xml` and ensure these
permissions are present **inside `<manifest>`** (Capacitor adds INTERNET
by default; the rest must be added manually):

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
                 android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />

<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.microphone" android:required="false" />
```

### Cleartext / network security config

Create `android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
```

Then reference it inside `<application>` in `AndroidManifest.xml`:

```xml
<application
  android:networkSecurityConfig="@xml/network_security_config"
  android:usesCleartextTraffic="false"
  ...>
```

### WebRTC: custom WebChromeClient

WebRTC needs `onPermissionRequest` to be granted. Create
`android/app/src/main/java/app/lovable/pulse/MainActivity.java`:

```java
package app.lovable.pulse;

import android.os.Build;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
  @Override
  public void onStart() {
    super.onStart();
    bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          runOnUiThread(() -> request.grant(request.getResources()));
        }
      }
    });
  }
}
```

### SDK targets

In `android/variables.gradle` make sure:

```groovy
ext {
    minSdkVersion = 24          // Android 7.0
    compileSdkVersion = 35      // Android 15
    targetSdkVersion = 35
}
```

After any of these edits, run `npx cap sync android`.

---

## 4. Build a debug APK (Android Studio)

```bash
npx cap open android
```

In Android Studio:

1. Wait for Gradle sync to finish.
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. Click **locate** in the bottom toast — your APK is at
   `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Drag-and-drop onto a connected device (USB debugging on) or use
   `adb install app-debug.apk`.

Or from the command line:

```bash
cd android && ./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 5. Build a signed release APK / AAB (for the Play Store)

### 5a. Generate a keystore (one time, keep it safe!)

```bash
keytool -genkey -v -keystore pulse-release.keystore \
  -alias pulse -keyalg RSA -keysize 2048 -validity 10000
```

Store the keystore **outside** the repo (e.g. `~/keystores/`). You will be
asked for a keystore password and a key password — record them in a
password manager.

### 5b. Configure signing

Create `android/keystore.properties` (and add it to `.gitignore`):

```properties
storeFile=/Users/you/keystores/pulse-release.keystore
storePassword=********
keyAlias=pulse
keyPassword=********
```

Edit `android/app/build.gradle`:

```groovy
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 5c. Build

```bash
cd android
./gradlew assembleRelease       # APK  (sideloading)
./gradlew bundleRelease         # AAB  (Play Store upload)
```

Outputs:

* APK → `android/app/build/outputs/apk/release/app-release.apk`
* AAB → `android/app/build/outputs/bundle/release/app-release.aab`

Upload the AAB to Play Console → Production / Internal testing.

---

## 6. iOS: build & ship

```bash
npx cap open ios
```

In Xcode:

1. Select the **Pulse** target → **Signing & Capabilities** → choose your team.
2. Add capabilities: **Push Notifications**, **Background Modes** →
   *Voice over IP*, *Audio*, *Remote notifications*.
3. In **Info.plist**, add usage descriptions:
   * `NSCameraUsageDescription` — "Pulse uses your camera for video calls."
   * `NSMicrophoneUsageDescription` — "Pulse uses your microphone for calls."
   * `NSPhotoLibraryUsageDescription` — "Attach photos to your messages."
4. **Product → Archive** → Distribute App → App Store Connect.

---

## 7. Updating the app after web changes

Most updates are handled by the WebView pointing at your published URL —
just `npm run build` and re-deploy on Lovable, your APK/IPA picks up
changes on next launch.

If you change `capacitor.config.ts`, plugins, or native code:

```bash
npm run build
npx cap sync
# rebuild APK / re-archive in Xcode
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| White screen on launch | Confirm `server.url` in `capacitor.config.ts` is reachable from the device. |
| Camera/mic permission dialogs never show | Ensure manifest permissions + `MainActivity.java` `onPermissionRequest` handler. |
| Push notifications not delivered | Ensure you accepted the OS prompt, app is registered, and your VAPID keys match. |
| Mixed-content errors | Set `cleartext: false` and serve everything over HTTPS. |
| Old web content cached | Bump the SW version (any change to `src/sw.ts` triggers an update). |

That's it — happy shipping! 🚀
