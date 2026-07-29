//! Foreground-service control, so a transfer survives the app being backgrounded.
//!
//! Android freezes and eventually kills a backgrounded process, and croc is a *child*
//! process of ours — so it dies with us, mid-transfer. A foreground service is the only
//! way to ask not to be frozen.
//!
//! The service runs in the **same process** as the activity (no `android:process`), so it
//! does not own the transfer and nothing about `spawn_transfer` changes: it exists purely
//! to keep the process alive. `croc.rs` starts it with the first transfer and stops it
//! with the last, so the notification is only up while something is actually running.
//!
//! Every failure degrades to a log line rather than failing the transfer. A transfer with
//! no service is still worth running — it just won't survive backgrounding — and
//! `startForegroundService` throws outright if Android has already decided we're in the
//! background (API 31+), which is exactly the case where the user isn't watching anyway.

use jni::objects::JValue;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Ask Android to keep this process alive. Idempotent: a second call just delivers
/// another `onStartCommand`, and the service re-posts the same notification.
pub fn start() {
    if let Err(e) = post(None, false) {
        warn(&format!(
            "foreground service not started ({e}); a backgrounded transfer may be killed"
        ));
    }
}

/// Drop back to a normal background process, clearing the notification.
///
/// Sent as a *start* intent carrying `stop`, not as `stopService`: those are two different
/// call paths with no ordering guarantee between them, so a progress update posted a moment
/// earlier could be processed *after* the stop and re-post a notification with no service
/// left to withdraw it. Going out the same way as the updates keeps them in order.
pub fn stop() {
    *LAST_POSTED.lock().unwrap() = None;
    if let Err(e) = post(None, true) {
        warn(&format!(
            "foreground service not stopped ({e}); the notification may linger"
        ));
    }
}

/// Last (instant, percent) pushed to the notification, for throttling.
static LAST_POSTED: Mutex<Option<(Instant, u32)>> = Mutex::new(None);

/// Show transfer progress on the service's notification — the only view of the transfer
/// once the app is off-screen.
///
/// Throttled here rather than at the call site: croc emits a progress line per redraw
/// (dozens a second), and each update is a binder round trip to post a notification no
/// human can read that fast. One a second, plus the final 100% so the bar always lands
/// full before the notification goes away.
pub fn progress(percent: u32, file: Option<&str>) {
    {
        let mut last = LAST_POSTED.lock().unwrap();
        if let Some((at, was)) = *last {
            let stale = at.elapsed() >= Duration::from_secs(1);
            if (percent == was || !stale) && percent < 100 {
                return;
            }
            if percent == was && was >= 100 {
                return;
            }
        }
        *last = Some((Instant::now(), percent));
    }
    if let Err(e) = post(Some((percent, file)), false) {
        warn(&format!("progress notification not updated ({e})"));
    }
}

/// Straight to logcat via `android.util.Log`, because `log::warn!` goes nowhere here:
/// tauri-plugin-log is desktop-only, so nothing installs a logger on Android. The first
/// version of this file failed silently on device for exactly that reason.
fn warn(msg: &str) {
    let Some(vm) = crate::android_saf::vm() else {
        return;
    };
    let Ok(mut env) = vm.attach_current_thread() else {
        return;
    };
    let (Ok(tag), Ok(text)) = (env.new_string("croc"), env.new_string(msg)) else {
        return;
    };
    let _ = env.call_static_method(
        "android/util/Log",
        "w",
        "(Ljava/lang/String;Ljava/lang/String;)I",
        &[JValue::Object(&tag), JValue::Object(&text)],
    );
}

/// Everything goes out as one call shape — `startForegroundService` with extras — so
/// starts, progress updates and the stop are delivered in the order they were made.
fn post(progress: Option<(u32, Option<&str>)>, stop: bool) -> Result<(), String> {
    let vm = crate::android_saf::vm().ok_or("nativeInit never ran, so there's no JavaVM")?;
    let context = crate::android_saf::context().ok_or("no app Context")?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;

    // Exported by MainActivity.onCreate. Do NOT rebuild this from getPackageName(): that
    // returns the applicationId, which on a debug build is `…crocdesktop.debug` while the
    // class stays in `…crocdesktop` — so the name misses and, because
    // startForegroundService answers an unresolvable component with a null ComponentName
    // rather than an exception, it misses *silently*. That cost a whole device test.
    let class_name = std::env::var("CROC_FGS_CLASS")
        .map_err(|_| "CROC_FGS_CLASS unset — MainActivity never exported the service class")?;

    // setClassName(Context, String) instead of Intent(Context, Class): naming the class as
    // a string avoids a find_class on a slash-separated path.
    let intent = env
        .new_object("android/content/Intent", "()V", &[])
        .map_err(|e| format!("no Intent: {e}"))?;
    let class_name = env.new_string(class_name).map_err(|e| e.to_string())?;
    env.call_method(
        &intent,
        "setClassName",
        "(Landroid/content/Context;Ljava/lang/String;)Landroid/content/Intent;",
        &[
            JValue::Object(context.as_obj()),
            JValue::Object(&class_name),
        ],
    )
    .map_err(|e| format!("setClassName: {e}"))?;

    // Progress rides as extras; a start with none leaves the bar indeterminate until the
    // first real progress line arrives.
    if let Some((percent, file)) = progress {
        let key = env.new_string("percent").map_err(|e| e.to_string())?;
        env.call_method(
            &intent,
            "putExtra",
            "(Ljava/lang/String;I)Landroid/content/Intent;",
            &[JValue::Object(&key), JValue::Int(percent as i32)],
        )
        .map_err(|e| format!("putExtra percent: {e}"))?;

        if let Some(file) = file {
            let key = env.new_string("file").map_err(|e| e.to_string())?;
            let value = env.new_string(file).map_err(|e| e.to_string())?;
            env.call_method(
                &intent,
                "putExtra",
                "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
                &[JValue::Object(&key), JValue::Object(&value)],
            )
            .map_err(|e| format!("putExtra file: {e}"))?;
        }
    }

    if stop {
        let key = env.new_string("stop").map_err(|e| e.to_string())?;
        env.call_method(
            &intent,
            "putExtra",
            "(Ljava/lang/String;Z)Landroid/content/Intent;",
            &[JValue::Object(&key), JValue::Bool(1)],
        )
        .map_err(|e| format!("putExtra stop: {e}"))?;
    }

    // startForegroundService, not startService: API 26+ refuses to start a plain
    // background service, and this is the call that promises we'll reach
    // startForeground() within a few seconds (TransferService does it first thing).
    let method = "startForegroundService";
    let called = env.call_method(
        context.as_obj(),
        method,
        "(Landroid/content/Intent;)Landroid/content/ComponentName;",
        &[JValue::Object(&intent)],
    );

    // A pending exception poisons every later JNI call on this thread, so clear it before
    // returning — the SAF and MediaStore paths share this thread.
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err(format!("{method} threw"));
    }
    let value = called.map_err(|e| format!("{method}: {e}"))?;

    // A null ComponentName means Android resolved no such service — the failure mode that
    // hid the class-name bug. Treat it as the error it is.
    let component = value.l().map_err(|e| format!("{method} return: {e}"))?;
    if component.is_null() {
        return Err(format!("{method} resolved no service"));
    }
    Ok(())
}
