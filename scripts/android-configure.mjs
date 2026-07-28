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

/** Launcher name. Matches APP_NAME in src/lib/platform.ts and the APK filename. */
const APP_LABEL = 'Croc Mobile';

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

  // Guard on a permission ONLY this block declares. Tauri's template already ships
  // <uses-permission android:name="android.permission.INTERNET" />, so keying on that
  // silently skipped everything else (caught by dumping the APK: no CAMERA, no
  // FOREGROUND_SERVICE*). Manifest merging dedupes the INTERNET we re-declare.
  if (!out.includes('FOREGROUND_SERVICE_DATA_SYNC')) {
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

  // Release signing. Tauri's template leaves the release buildType unsigned, which
  // produces an APK Android refuses to install. Read the key from a gitignored
  // keystore.properties when present, and otherwise leave the build unsigned so a
  // local `android:build` still works for anyone without the release key.
  if (!out.includes('signingConfigs')) {
    out = insertBefore(
      out,
      '\n    buildTypes {',
      `
    signingConfigs {
        create("release") {
            val propsFile = rootProject.file("keystore.properties")
            if (propsFile.exists()) {
                // Parsed by hand rather than with java.util.Properties: in the Gradle
                // Kotlin DSL \`java\` resolves to the Java plugin extension and shadows
                // the package, and an \`import\` would have to go at the top of a file
                // this script only ever patches in the middle.
                val props = propsFile.readLines()
                    .filter { it.contains("=") && !it.trimStart().startsWith("#") }
                    .associate { line ->
                        val i = line.indexOf('=')
                        line.substring(0, i).trim() to line.substring(i + 1).trim()
                    }
                // rootProject, not file(): the keystore sits beside keystore.properties
                // in the android project root, while file() would resolve into app/.
                storeFile = rootProject.file(props["storeFile"] ?: "release.jks")
                storePassword = props["storePassword"]
                keyAlias = props["keyAlias"]
                keyPassword = props["keyPassword"]
            }
        }
    }
`,
      'signingConfigs',
    );
  }

  // Attach it to the release buildType (the template's block has no signingConfig).
  if (!out.includes('signingConfig = signingConfigs')) {
    out = insertBefore(
      out,
      '\n        getByName("release") {\n            isMinifyEnabled',
      '',
      'release buildType',
    );
    out = out.replace(
      '        getByName("release") {\n            isMinifyEnabled',
      `        getByName("release") {
            // Unsigned when keystore.properties is absent — Gradle then emits
            // app-universal-release-unsigned.apk instead of failing the build.
            if (rootProject.file("keystore.properties").exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled`,
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

import android.content.Context
import android.os.Bundle
import android.system.Os
import android.util.Log

class MainActivity : TauriActivity() {
    /**
     * Hands the Rust side a JavaVM and an app Context so it can query the
     * ContentResolver for a picked file's display name. Nothing in Tauri's Android
     * stack initialises ndk_context and wry keeps its JavaVM private, so this is how
     * Rust gets one. Implemented in src/android_saf.rs.
     */
    private external fun nativeInit(ctx: Context)

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

        // AFTER super.onCreate: the native library isn't loaded before that. The JNI
        // symbol encodes the package name, so a rename of the bundle identifier
        // breaks the link — degrade to URI-derived filenames instead of crashing.
        runCatching { nativeInit(applicationContext) }
            .onFailure { Log.w("croc", "nativeInit unavailable; picked files fall back to URI names", it) }
    }
}
`;
});

// ── 4. res/values/strings.xml — the launcher label ───────────────────────────
//
// `tauri android init` reads productName from tauri.conf.json only; the
// tauri.android.conf.json override that renames the app for mobile never reaches
// the generated strings.xml, so the launcher and the "Open with" chooser both say
// "Croc Desktop" on a phone. That matters more than it sounds: with croc-app and
// both build variants installed, the chooser lists three entries and two of them
// carry the desktop's name.
const strings = join(APP, 'src', 'main', 'res', 'values', 'strings.xml');

patch(strings, 'res/values/strings.xml', (src) => {
  let out = src;
  for (const key of ['app_name', 'main_activity_title']) {
    const re = new RegExp(`(<string name="${key}">)("?)[^<]*?\\2(</string>)`);
    if (!re.test(out)) {
      throw new Error(
        `[android-configure] no <string name="${key}"> in strings.xml — ` +
          `the Tauri Android template probably changed.`,
      );
    }
    out = out.replace(re, `$1"${APP_LABEL}"$3`);
  }
  return out;
});

console.log(
  changed === 0
    ? '[android-configure] nothing to do — project already configured'
    : `[android-configure] done (${changed} file(s) patched)`,
);
