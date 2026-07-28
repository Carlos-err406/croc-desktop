#!/usr/bin/env node
/**
 * Apply this app's Android customisations to the project `tauri android init`
 * generates.
 *
 * Why a patch script instead of committing src-tauri/gen/android: that tree is
 * generated output tied to the Tauri version, and regenerating it is how you pick up
 * upstream template fixes. Keeping our deltas here means `init` stays disposable and
 * a clean checkout can build.
 *
 * Every edit asserts on what it expects to find and is a no-op if already applied,
 * so a Tauri template change fails the build loudly rather than silently dropping
 * (say) the permission that makes transfers survive backgrounding.
 *
 * Run AFTER `tauri android init`, BEFORE `tauri android build`.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'src-tauri', 'gen', 'android');
const APP = join(ANDROID, 'app');

/** The https origin whose /croc/* links should open the app (App Links). */
const APP_LINK_HOST = 'carlos-err406.github.io';

if (!existsSync(APP)) {
  console.error(
    `[android-configure] ${APP} not found — run \`npm run tauri -- android init\` first.`,
  );
  process.exit(1);
}

let changed = 0;

/** Read → transform → write, reporting whether anything moved. */
function patch(file, label, fn) {
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) {
    console.log(`[android-configure] ${label}: already applied`);
    return;
  }
  writeFileSync(file, after);
  console.log(`[android-configure] ${label}: patched`);
  changed += 1;
}

/** Insert `text` before `anchor`, asserting the anchor exists exactly once. */
function insertBefore(src, anchor, text, label) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) {
    throw new Error(
      `[android-configure] expected exactly one "${anchor}" for ${label}, found ${n}. ` +
        `The Tauri Android template probably changed — re-check this script.`,
    );
  }
  return src.replace(anchor, `${text}${anchor}`);
}

// ── 1. AndroidManifest.xml ───────────────────────────────────────────────────
const manifest = join(APP, 'src', 'main', 'AndroidManifest.xml');

const PERMISSIONS = `    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <!-- Transfers keep running while the app is backgrounded. Without a foreground
         service Android freezes the app and croc dies mid-transfer. -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <!-- Transfer-finished notifications; prompted at runtime on API 33+. -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <!-- Shipping via GitHub means no store to update us, so the app installs its own
         APK; the user still confirms in the system installer. -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    <!-- QR scanning. Optional so the app still installs on a camera-less device. -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />

`;

// Intent filters live inside the generated MainActivity <activity> element.
const INTENT_FILTERS = `
            <!-- Scanned QR / tapped croc:// link → open straight into receiving (or
                 sending, for a reverse-pairing invite). -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="croc" />
            </intent-filter>

            <!-- The shareable https twin of the same link. Needs assetlinks.json (with
                 this build's signing cert SHA-256) served from the host, or Android
                 shows a chooser instead of opening the app. -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${APP_LINK_HOST}" android:pathPrefix="/croc" />
            </intent-filter>

            <!-- Share sheet: the phone equivalent of desktop's "Open With". -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="*/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="*/*" />
            </intent-filter>
`;

patch(manifest, 'AndroidManifest.xml', (src) => {
  let out = src;

  if (!out.includes('android.permission.INTERNET')) {
    out = insertBefore(out, '    <application', PERMISSIONS, 'permissions');
  }

  // croc must be UNPACKED to disk to be executable: AGP defaults extractNativeLibs
  // to false above minSdk 23, which would leave libcroc.so readable only inside the
  // APK — and Android can't exec that.
  if (!out.includes('android:extractNativeLibs')) {
    out = insertBefore(
      out,
      '\n        android:label',
      '\n        android:extractNativeLibs="true"',
      'extractNativeLibs',
    );
  }

  if (!out.includes('android.intent.action.SEND')) {
    out = insertBefore(out, '        </activity>', INTENT_FILTERS, 'intent filters');
  }

  return out;
});

// ── 2. app/build.gradle.kts ──────────────────────────────────────────────────
const gradle = join(APP, 'build.gradle.kts');

patch(gradle, 'app/build.gradle.kts', (src) => {
  let out = src;

  // AGP strips native libraries by default, which corrupts a Go executable; and
  // arm64 is the only ABI croc cross-compiles to without the NDK's clang
  // (android/arm and android/amd64 both require cgo), so declare that honestly
  // rather than shipping an APK that installs and then can't transfer.
  if (!out.includes('keepDebugSymbols')) {
    out = insertBefore(
      out,
      '\n    buildTypes {',
      `
    packaging {
        jniLibs {
            // Never strip croc — it's an executable, not a real shared library.
            keepDebugSymbols += "**/libcroc.so"
            // Force extraction to nativeLibraryDir, the one place we may exec from.
            useLegacyPackaging = true
        }
    }
`,
      'jniLibs packaging',
    );
  }

  if (!out.includes('abiFilters')) {
    out = insertBefore(
      out,
      '\n    buildTypes {',
      `
    defaultConfig {
        ndk {
            // croc builds for android/arm64 only without an NDK C compiler.
            abiFilters += listOf("arm64-v8a")
        }
    }
`,
      'abiFilters',
    );
  }

  return out;
});

// ── 3. MainActivity.kt — hand croc's path to the Rust side ───────────────────
function findMainActivity(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const found = findMainActivity(p);
      if (found) return found;
    } else if (entry === 'MainActivity.kt') {
      return p;
    }
  }
  return null;
}

const mainActivity = findMainActivity(join(APP, 'src', 'main'));
if (!mainActivity) {
  throw new Error('[android-configure] MainActivity.kt not found under app/src/main');
}

patch(mainActivity, 'MainActivity.kt', (src) => {
  if (src.includes('CROC_BIN')) return src;

  const pkg = src.match(/^package\s+([\w.]+)/m);
  if (!pkg) throw new Error('[android-configure] no package declaration in MainActivity.kt');

  // Replaced wholesale: the generated file's only job is to extend TauriActivity, and
  // this keeps the CROC_BIN hook readable in one place.
  return `package ${pkg[1]}

import android.os.Bundle
import android.system.Os

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // croc ships as jniLibs/<abi>/libcroc.so, so the installer unpacks it into
        // nativeLibraryDir — the only directory an app may execute from
        // (app-writable storage is mounted no-exec). Rust can't read ApplicationInfo
        // without JNI, so hand it the path through the environment instead:
        // find_croc_binary() already prefers CROC_BIN.
        //
        // Set before super.onCreate, which is what starts the Rust side.
        Os.setenv("CROC_BIN", "\${applicationInfo.nativeLibraryDir}/libcroc.so", true)
        super.onCreate(savedInstanceState)
    }
}
`;
});

console.log(
  changed === 0
    ? '[android-configure] nothing to do — project already configured'
    : `[android-configure] done (${changed} file(s) patched)`,
);
