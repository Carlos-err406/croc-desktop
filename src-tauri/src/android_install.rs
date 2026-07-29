//! Downloading and installing an APK update, in-app.
//!
//! Two things make this less obvious than it sounds, both learned the hard way on device:
//!
//! 1. Handing the asset URL to `ACTION_VIEW` doesn't work. The GitHub app holds *verified*
//!    App Links for github.com, so the intent goes to it — behind its app lock — and no
//!    download ever starts. Anyone with that app installed could never self-update.
//! 2. Fetching it in the webview doesn't work either. `api.github.com` sends
//!    `access-control-allow-origin: *`, which is why *checking* works, but the asset
//!    redirects to release-assets.githubusercontent.com, which sends no CORS header at
//!    all — so the cross-origin fetch is blocked before a byte moves.
//!
//! So the download is handed to Android's own `DownloadManager` (see CrocUpdater.kt): it
//! follows the redirect chain, survives backgrounding, shows progress in the notification
//! shade, and isn't subject to CORS. `reqwest` isn't an option here — its rustls path
//! needs a C toolchain for the Android target, which is the same reason
//! tauri-plugin-updater is desktop-only.
//!
//! Installing is ours: the file goes to the package installer as a FileProvider
//! `content://` URI, so *Croc* is the install source. That's what REQUEST_INSTALL_PACKAGES
//! in the manifest is for — the user approves this app once, rather than approving
//! whichever browser happened to win the intent.

use jni::objects::{JObject, JString, JValue};
use jni::JNIEnv;
use std::sync::Mutex;
use tauri::AppHandle;

/// The DownloadManager id of the download in flight, so `poll` can ask about it.
static DOWNLOAD_ID: Mutex<Option<i64>> = Mutex::new(None);

/// `CrocUpdater`'s JNI class name, exported by MainActivity.
///
/// Not derived from `getPackageName()`: that returns the applicationId, which carries
/// `.debug` on a debug build while the Kotlin package does not — the mistake that made the
/// foreground service silently never start.
fn updater_class() -> Result<String, String> {
    let name = std::env::var("CROC_UPDATER_CLASS")
        .map_err(|_| "CROC_UPDATER_CLASS unset — MainActivity never exported the class")?;
    Ok(name.replace('.', "/"))
}

fn jstring_to_string(env: &mut JNIEnv, obj: JObject) -> Result<String, String> {
    Ok(env
        .get_string(&JString::from(obj))
        .map_err(|e| e.to_string())?
        .into())
}

/// Ask DownloadManager for the APK. Returns as soon as it's queued.
pub fn download_start(_app: &AppHandle, url: &str) -> Result<(), String> {
    let vm = crate::android_saf::vm().ok_or("nativeInit never ran, so there's no JavaVM")?;
    let context = crate::android_saf::context().ok_or("no app Context")?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let class = updater_class()?;

    let jurl = env.new_string(url).map_err(|e| e.to_string())?;
    let id = env
        .call_static_method(
            &class,
            "start",
            "(Landroid/content/Context;Ljava/lang/String;)J",
            &[JValue::Object(context.as_obj()), JValue::Object(&jurl)],
        )
        .and_then(|v| v.j())
        .map_err(|e| format!("enqueue: {e}"))?;

    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err("DownloadManager refused the request".into());
    }
    if id < 0 {
        return Err("DownloadManager wouldn't queue the download".into());
    }
    *DOWNLOAD_ID.lock().unwrap() = Some(id);
    Ok(())
}

/// `"downloading:<so_far>:<total>"`, `"done:<so_far>:<total>"` or `"error:<why>"`.
///
/// A string rather than a struct because it crosses JNI *and* the IPC boundary, and one
/// shape both sides can read beats two mirrored types.
pub fn download_poll(_app: &AppHandle) -> Result<String, String> {
    let id = DOWNLOAD_ID
        .lock()
        .unwrap()
        .ok_or("no download has been started")?;
    let vm = crate::android_saf::vm().ok_or("no JavaVM")?;
    let context = crate::android_saf::context().ok_or("no app Context")?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let class = updater_class()?;

    let out = env
        .call_static_method(
            &class,
            "poll",
            "(Landroid/content/Context;J)Ljava/lang/String;",
            &[JValue::Object(context.as_obj()), JValue::Long(id)],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("poll: {e}"))?;
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err("DownloadManager query threw".into());
    }
    jstring_to_string(&mut env, out)
}

/// Hand the downloaded APK to the system package installer.
pub fn install(_app: &AppHandle) -> Result<(), String> {
    let vm = crate::android_saf::vm().ok_or("no JavaVM")?;
    let context = crate::android_saf::context().ok_or("no app Context")?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let class = updater_class()?;

    // Kotlin owns the destination so the two halves can't disagree about the path.
    let path_obj = env
        .call_static_method(
            &class,
            "destPath",
            "(Landroid/content/Context;)Ljava/lang/String;",
            &[JValue::Object(context.as_obj())],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("destPath: {e}"))?;
    let path = jstring_to_string(&mut env, path_obj)?;

    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Err("the downloaded file is missing or empty".into());
    }

    let jpath = env.new_string(&path).map_err(|e| e.to_string())?;
    let file = env
        .new_object(
            "java/io/File",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&jpath)],
        )
        .map_err(|e| format!("File: {e}"))?;

    // The authority IS derived from the applicationId here, because that's what the
    // manifest's ${applicationId}.fileprovider expands to — the provider is Tauri's own,
    // and its file_paths.xml already covers external storage and the cache dir. Do not add
    // a second provider: a duplicate authority fails at install time.
    let pkg_obj = env
        .call_method(
            context.as_obj(),
            "getPackageName",
            "()Ljava/lang/String;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("no package name: {e}"))?;
    let pkg = jstring_to_string(&mut env, pkg_obj)?;
    let authority = env
        .new_string(format!("{pkg}.fileprovider"))
        .map_err(|e| e.to_string())?;

    // A file:// URI would throw FileUriExposedException on anything since API 24.
    let uri = env
        .call_static_method(
            "androidx/core/content/FileProvider",
            "getUriForFile",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
            &[
                JValue::Object(context.as_obj()),
                JValue::Object(&authority),
                JValue::Object(&file),
            ],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("FileProvider: {e}"))?;

    let action = env
        .new_string("android.intent.action.VIEW")
        .map_err(|e| e.to_string())?;
    let intent = env
        .new_object(
            "android/content/Intent",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&action)],
        )
        .map_err(|e| format!("Intent: {e}"))?;
    let mime = env
        .new_string("application/vnd.android.package-archive")
        .map_err(|e| e.to_string())?;
    env.call_method(
        &intent,
        "setDataAndType",
        "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
        &[JValue::Object(&uri), JValue::Object(&mime)],
    )
    .map_err(|e| format!("setDataAndType: {e}"))?;

    // GRANT_READ_URI_PERMISSION (1) so the installer may read our content URI, and
    // NEW_TASK (0x1000_0000) because this starts from an application context.
    env.call_method(
        &intent,
        "addFlags",
        "(I)Landroid/content/Intent;",
        &[JValue::Int(0x1 | 0x1000_0000)],
    )
    .map_err(|e| format!("addFlags: {e}"))?;

    env.call_method(
        context.as_obj(),
        "startActivity",
        "(Landroid/content/Intent;)V",
        &[JValue::Object(&intent)],
    )
    .map_err(|e| format!("startActivity: {e}"))?;

    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err("the installer refused the APK".into());
    }
    Ok(())
}
