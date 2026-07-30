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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(join(dir, entry)).isDirectory()) {
      out.push(...filesUnder(join(dir, entry), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
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
    <!-- Nearby devices: mDNS answers are multicast, and Android drops multicast under
         Wi-Fi power-save unless we hold a MulticastLock. See src/android_multicast.rs. -->
    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
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

// Keeps the process alive for the duration of a transfer. Same process as the activity
// (no android:process), so it doesn't own the transfer — Rust starts and stops it from
// android_fgs.rs. Not exported: nothing outside the app has any business starting it.
const SERVICE = `
        <service
            android:name=".TransferService"
            android:exported="false"
            android:foregroundServiceType="dataSync" />

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

  // A fresh tree gets CHANGE_WIFI_MULTICAST_STATE inside PERMISSIONS above, but a tree
  // patched before nearby worked on Android already satisfies that guard — so this one
  // stands alone. The lesson from FOREGROUND_SERVICE*: a guard keyed on an older marker
  // silently skips everything added after it.
  if (!out.includes('CHANGE_WIFI_MULTICAST_STATE')) {
    out = insertBefore(
      out,
      '    <application',
      '    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />\n\n',
      'multicast permission',
    );
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

  // The service the FOREGROUND_SERVICE permissions above exist for. dataSync is the
  // type that fits a file transfer; Android 14+ rejects startForeground() if the type
  // here and the permission don't agree.
  if (!out.includes('TransferService')) {
    out = insertBefore(out, '    </application>', SERVICE, 'transfer service');
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

// ── 3. MainActivity.kt — the two hooks Rust needs from Kotlin ────────────────
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
  // Guarded on the newest hook rather than the file being ours, so extending this
  // template re-patches an activity an older run already replaced.
  if (src.includes('CROC_UPDATER_CLASS')) return src;

  const pkg = src.match(/^package\s+([\w.]+)/m);
  if (!pkg) throw new Error('[android-configure] no package declaration in MainActivity.kt');

  // Replaced wholesale: the generated file's only job is to extend TauriActivity, and
  // this keeps the CROC_BIN hook readable in one place.
  return `package ${pkg[1]}

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
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

    /**
     * Hands over a share-sheet payload. tauri-plugin-deep-link only handles
     * ACTION_VIEW, so SEND intents have no route into the app without this.
     * Implemented in src/android_share.rs.
     */
    private external fun nativeShare(uris: Array<String>, text: String?)

    override fun onCreate(savedInstanceState: Bundle?) {
        // croc ships as jniLibs/<abi>/libcroc.so, so the installer unpacks it into
        // nativeLibraryDir — the only directory an app may execute from
        // (app-writable storage is mounted no-exec). Rust can't read ApplicationInfo
        // without JNI, so hand it the path through the environment instead:
        // find_croc_binary() already prefers CROC_BIN.
        //
        // Set before super.onCreate, which is what starts the Rust side.
        Os.setenv("CROC_BIN", "\${applicationInfo.nativeLibraryDir}/libcroc.so", true)

        // Same trick for the foreground service. Rust needs the service's fully-qualified
        // class name, and it CANNOT derive it: getPackageName() returns the applicationId,
        // which carries the .debug suffix on debug builds and so doesn't match the Kotlin
        // package. Letting Kotlin name its own class keeps the two in step through any
        // rename. Read in src/android_fgs.rs.
        Os.setenv("CROC_FGS_CLASS", TransferService::class.java.name, true)

        // Same again for the updater helper: android_install.rs looks the class up by
        // name, and it CANNOT be rebuilt from getPackageName() — that returns the
        // applicationId, which carries .debug on a debug build while the Kotlin package
        // does not.
        Os.setenv("CROC_UPDATER_CLASS", CrocUpdater::class.java.name, true)
        super.onCreate(savedInstanceState)

        // AFTER super.onCreate: the native library isn't loaded before that. The JNI
        // symbol encodes the package name, so a rename of the bundle identifier
        // breaks the link — degrade to URI-derived filenames instead of crashing.
        runCatching { nativeInit(applicationContext) }
            .onFailure { Log.w("croc", "nativeInit unavailable; picked files fall back to URI names", it) }

        handleShare(intent)
    }

    // launchMode is singleTask, so a share arriving while the app is already open
    // lands here instead of starting a second activity.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShare(intent)
    }

    /**
     * Queue an ACTION_SEND / ACTION_SEND_MULTIPLE payload for the UI to pick up.
     * Only reads the intent — copying the content:// URIs is Rust's job, done when
     * the frontend drains them, so a failed copy has somewhere to be reported.
     */
    private fun handleShare(intent: Intent?) {
        if (intent == null) return
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) return

        val uris = streamUris(intent)
        // Text only when nothing else came with it: a shared photo often carries a
        // caption in EXTRA_TEXT, and that isn't what the user asked to send.
        val text = if (uris.isEmpty()) intent.getStringExtra(Intent.EXTRA_TEXT) else null
        if (uris.isEmpty() && text.isNullOrBlank()) return

        runCatching { nativeShare(uris.map(Uri::toString).toTypedArray(), text) }
            .onFailure { Log.w("croc", "nativeShare unavailable; dropping the shared payload", it) }
    }

    @Suppress("DEPRECATION")
    private fun streamUris(intent: Intent): List<Uri> {
        val typed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        return if (intent.action == Intent.ACTION_SEND) {
            val uri =
                if (typed) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            listOfNotNull(uri)
        } else {
            val list =
                if (typed) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
            list?.filterNotNull() ?: emptyList()
        }
    }
}
`;
});

// ── 3b. TransferService.kt — the service that keeps a transfer alive ─────────
//
// Its own file rather than more of MainActivity: nothing here is activity lifecycle, and
// keeping it separate means the wholesale MainActivity replacement above can't clobber it.
{
  const pkg = readFileSync(mainActivity, 'utf8').match(/^package\s+([\w.]+)/m);
  if (!pkg) throw new Error('[android-configure] no package declaration in MainActivity.kt');
  const servicePath = join(dirname(mainActivity), 'TransferService.kt');
  const source = `package ${pkg[1]}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps the app's process alive while a transfer runs.
 *
 * croc is a child process of ours, so when Android freezes or kills a backgrounded app
 * the transfer dies with it. A foreground service is the only way to opt out of that.
 * It deliberately runs in the same process and holds no transfer state: src/croc.rs owns
 * the child, and src/android_fgs.rs starts this with the first transfer and stops it with
 * the last. Generated by scripts/android-configure.mjs — edit it there.
 */
class TransferService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private var clearedStale = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        // IMPORTANCE_DEFAULT with the sound explicitly nulled, NOT IMPORTANCE_LOW. Low
        // marks the notification silent, and Android hides silent notifications' status-bar
        // icons and files them under "more notifications" — so the one indication that a
        // transfer is still running was invisible unless you pulled the shade down. Default
        // keeps the icon; sound and vibration are off, so it still doesn't announce itself.
        manager.deleteNotificationChannel(OLD_CHANNEL)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Transfers", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Progress while a transfer is running"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Stop arrives as a start intent carrying EXTRA_STOP, NOT as stopService(): those
        // are two different call paths with no ordering guarantee, so a stop could be
        // handled before a progress update sent a moment earlier, and that update would
        // then re-post this notification with no service left to withdraw it. Same path =
        // same order. Stopping here instead of calling startForeground is allowed.
        if (intent?.getBooleanExtra(EXTRA_STOP, false) == true) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        // Clear leftovers from a finished transfer, once per run, BEFORE posting ours.
        // With two notifications Android groups them and files the ongoing one under
        // "1 more notification" — burying the one whose entire job is to say it's still
        // running. Only on the first start, or every progress update would re-do it.
        if (!clearedStale) {
            clearedStale = true
            getSystemService(NotificationManager::class.java).cancelAll()
        }

        // Rust re-starts the service to push each progress update; -1 means it had nothing
        // to report yet, which shows as an indeterminate bar.
        val percent = intent?.getIntExtra(EXTRA_PERCENT, -1) ?: -1
        val file = intent?.getStringExtra(EXTRA_FILE)

        // First thing, before any other work: startForegroundService() gives us only a
        // few seconds to get here, and missing that window is an ANR. Calling it again on
        // later starts is also how the notification gets updated.
        val notification = notification(percent, file)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(ID, notification)
        }

        // A foreground service stops us being frozen, but not the CPU idling in doze
        // mid-transfer. Timed out rather than indefinite so a service that somehow
        // outlives its transfer can't sit on the battery; stop() releases it normally.
        if (wakeLock?.isHeld != true) {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock =
                pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "croc:transfer").apply {
                    setReferenceCounted(false)
                    acquire(WAKE_LOCK_TIMEOUT_MS)
                }
        }

        // NOT sticky: if Android kills us, there is no transfer left to guard, and a
        // restarted service would post a notification with nothing behind it.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        // Belt and braces: Android drops the notification with the service anyway, but this
        // one is NO_CLEAR, so if it ever did outlive the service the user couldn't swipe it
        // away. Cheap to say explicitly.
        stopForeground(STOP_FOREGROUND_REMOVE)
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    private fun notification(percent: Int, file: String?): Notification {
        // Tapping it returns to the transfer rather than starting a second activity;
        // MainActivity is singleTask, so this reuses the existing one.
        val reopen =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java).apply {
                    action = Intent.ACTION_MAIN
                    addCategory(Intent.CATEGORY_LAUNCHER)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        return Notification.Builder(this, CHANNEL)
            // The croc silhouette, copied into res/drawable-* by android-configure.mjs.
            // A status-bar icon must be a flat alpha mask — the adaptive launcher icon
            // would render as a white blob.
            .setSmallIcon(R.drawable.ic_croc_notification)
            .setContentTitle(if (percent in 0..100) "Transferring — \$percent%" else "Transferring")
            .setContentText(file ?: "Keeping the transfer running in the background")
            // Indeterminate until croc reports a percentage, so the notification never
            // claims 0% while it's really still pairing.
            .setProgress(100, percent.coerceAtLeast(0), percent !in 0..100)
            .setContentIntent(reopen)
            .setOngoing(true)
            // Declare what this is. Without a category One UI files it under "More
            // notifications" — its minimised bucket — and minimised notifications get no
            // status-bar icon, so the one notification whose job is "still running" is the
            // one you can't see. CATEGORY_PROGRESS is what a determinate transfer is.
            .setCategory(Notification.CATEGORY_PROGRESS)
            // The result is announced separately by the app's own finish notification, so
            // this one carries no timestamp to argue with.
            .setShowWhen(false)
            .build()
    }

    private companion object {
        const val CHANNEL = "croc_transfer_progress"
        // The IMPORTANCE_LOW channel this replaces; deleted so it stops cluttering settings.
        const val OLD_CHANNEL = "croc_transfer"
        const val ID = 1
        const val EXTRA_PERCENT = "percent"
        const val EXTRA_FILE = "file"
        const val EXTRA_STOP = "stop"
        const val WAKE_LOCK_TIMEOUT_MS = 60L * 60L * 1000L
    }
}
`;
  const existing = existsSync(servicePath) ? readFileSync(servicePath, 'utf8') : null;
  if (existing === source) {
    console.log('[android-configure] TransferService.kt: already applied');
  } else {
    writeFileSync(servicePath, source);
    console.log(`[android-configure] TransferService.kt: ${existing ? 'patched' : 'written'}`);
    changed += 1;
  }
}

// ── 3c. CrocUpdater.kt — the APK download for in-app updates ─────────────────
//
// DownloadManager rather than anything of ours: it follows GitHub's redirect chain,
// survives the app being backgrounded, puts progress in the notification shade, and — the
// reason it exists at all — isn't subject to CORS. A webview fetch of the asset is blocked
// outright, because release-assets.githubusercontent.com sends no CORS header. Installing
// stays in src/android_install.rs.
{
  const pkg = readFileSync(mainActivity, 'utf8').match(/^package\s+([\w.]+)/m);
  if (!pkg) throw new Error('[android-configure] no package declaration in MainActivity.kt');
  const updaterPath = join(dirname(mainActivity), 'CrocUpdater.kt');
  const source = `package ${pkg[1]}

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import java.io.File

/**
 * Downloads the update APK with DownloadManager. Called over JNI from
 * src/android_install.rs — see the header there for why neither ACTION_VIEW on the asset
 * URL nor a webview fetch can do this. Generated by scripts/android-configure.mjs.
 */
object CrocUpdater {
    private const val FILE_NAME = "croc-update.apk"

    /**
     * Where the APK lands. getExternalFilesDir is app-scoped so it needs no storage
     * permission, and Tauri's own file_paths.xml already exposes external storage to the
     * FileProvider, so the installer can be handed a content:// URI for it.
     */
    @JvmStatic
    fun destPath(ctx: Context): String = File(ctx.getExternalFilesDir(null), FILE_NAME).absolutePath

    /** Queue the download. Returns its id, or -1 if DownloadManager wouldn't take it. */
    @JvmStatic
    fun start(ctx: Context, url: String): Long =
        try {
            // A stale APK left by a failed attempt would otherwise be what we install.
            File(destPath(ctx)).delete()
            val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(
                DownloadManager.Request(Uri.parse(url))
                    .setTitle("Croc Mobile update")
                    .setDescription("Downloading the new version")
                    .setDestinationUri(Uri.fromFile(File(destPath(ctx))))
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                    .setMimeType("application/vnd.android.package-archive")
                    .setAllowedOverMetered(true),
            )
        } catch (e: Throwable) {
            -1L
        }

    /** "downloading:<soFar>:<total>", "done:<soFar>:<total>" or "error:<why>". */
    @JvmStatic
    fun poll(ctx: Context, id: Long): String {
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val cursor = dm.query(DownloadManager.Query().setFilterById(id)) ?: return "error:no cursor"
        cursor.use {
            if (!it.moveToFirst()) return "error:the download disappeared"
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val soFar =
                it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
            return when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> "done:$soFar:$total"
                DownloadManager.STATUS_FAILED -> {
                    val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                    "error:download failed (reason $reason)"
                }
                else -> "downloading:$soFar:$total"
            }
        }
    }
}
`;
  const existing = existsSync(updaterPath) ? readFileSync(updaterPath, 'utf8') : null;
  if (existing === source) {
    console.log('[android-configure] CrocUpdater.kt: already applied');
  } else {
    writeFileSync(updaterPath, source);
    console.log(`[android-configure] CrocUpdater.kt: ${existing ? 'patched' : 'written'}`);
    changed += 1;
  }
}

// ── 3d. res/drawable-*/ic_croc_notification.png ──────────────────────────────
//
// Android status-bar icons are alpha masks: the system tints them, so anything with its own
// colours renders as a white blob. Without one, tauri-plugin-notification falls back to
// android.R.drawable.ic_dialog_info — the generic (i) that shipped up to 2.9.0.
//
// Committed rather than generated at build time (same as the launcher icons): a filled
// silhouette derived from src/assets/croc-icon.png, whose croc is a white stroke on green —
// so it was flood-filled into a solid body, with the artwork's own eye and jaw lines punched
// back out so it still reads as a crocodile at 24dp.
{
  const src = join(ROOT, 'src-tauri', 'icons', 'notification');
  if (!existsSync(src)) {
    throw new Error(`[android-configure] ${src} missing — the notification icon is committed`);
  }
  let copied = 0;
  for (const density of readdirSync(src)) {
    const from = join(src, density, 'ic_croc_notification.png');
    if (!existsSync(from)) continue;
    const toDir = join(APP, 'src', 'main', 'res', density);
    mkdirSync(toDir, { recursive: true });
    const to = join(toDir, 'ic_croc_notification.png');
    const bytes = readFileSync(from);
    if (!existsSync(to) || !readFileSync(to).equals(bytes)) {
      writeFileSync(to, bytes);
      copied += 1;
    }
  }
  if (copied) {
    console.log(`[android-configure] notification icon: copied ${copied} density/densities`);
    changed += 1;
  } else {
    console.log('[android-configure] notification icon: already applied');
  }
}

// ── 4. res/values/strings.xml — the launcher label ───────────────────────────
//
// `tauri android init` does honour tauri.android.conf.json's productName — but it
// won't overwrite a strings.xml that already exists, so a gen/ tree generated before
// that override was added keeps saying "Croc Desktop" forever. CI always starts
// clean and never hits this; a long-lived working copy does, and then only the
// developer's own builds carry the wrong name — which is the worst way to find out.
// Cheap to assert, so assert it.
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

// ── 5. Launcher icon ─────────────────────────────────────────────────────────
//
// `tauri android init` writes the template's default Tauri icon and never looks at
// src-tauri/icons/android, so a freshly generated project installs with the wrong
// launcher icon — which is what ships, since gen/android isn't committed.
//
// The icons themselves are committed (generated once by `tauri icon`), so this is a
// copy rather than a regeneration: no CLI to invoke and CI gets the same bytes.
const ICONS = join(ROOT, 'src-tauri', 'icons', 'android');
const RES = join(APP, 'src', 'main', 'res');

if (!existsSync(ICONS)) {
  throw new Error(
    `[android-configure] ${ICONS} not found — run \`npm run tauri -- icon <path>\` to generate the Android icon set.`,
  );
}

let icons = 0;
for (const file of filesUnder(ICONS)) {
  const src = readFileSync(join(ICONS, file));
  const dest = join(RES, file);
  if (existsSync(dest) && readFileSync(dest).equals(src)) continue;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, src);
  icons += 1;
}

// The template's own adaptive-icon parts. Ours (mipmap-anydpi-v26/ic_launcher.xml)
// references @mipmap/ic_launcher_foreground and @color/ic_launcher_background
// instead, so these are left referenced by nothing — and a stray green Android robot
// in the drawables is exactly the sort of thing that turns up in a store listing
// later. Verified unreferenced before removing.
for (const stale of [
  'drawable/ic_launcher_background.xml',
  'drawable-v24/ic_launcher_foreground.xml',
]) {
  const path = join(RES, stale);
  if (existsSync(path)) {
    rmSync(path);
    icons += 1;
  }
}

if (icons === 0) {
  console.log('[android-configure] launcher icon: already applied');
} else {
  console.log(`[android-configure] launcher icon: installed (${icons} file(s))`);
  changed += 1;
}

console.log(
  changed === 0
    ? '[android-configure] nothing to do — project already configured'
    : `[android-configure] done (${changed} file(s) patched)`,
);
