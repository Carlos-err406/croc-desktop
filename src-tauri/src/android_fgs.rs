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

use jni::objects::{JString, JValue};

/// Ask Android to keep this process alive. Idempotent: a second call just delivers
/// another `onStartCommand`, and the service re-posts the same notification.
pub fn start() {
    if let Err(e) = toggle(true) {
        log::warn!("foreground service not started ({e}); a backgrounded transfer may be killed");
    }
}

/// Drop back to a normal background process, clearing the notification.
pub fn stop() {
    if let Err(e) = toggle(false) {
        log::warn!("foreground service not stopped ({e}); the notification may linger");
    }
}

fn toggle(on: bool) -> Result<(), String> {
    let vm = crate::android_saf::vm().ok_or("nativeInit never ran, so there's no JavaVM")?;
    let context = crate::android_saf::context().ok_or("no app Context")?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;

    // Resolved from getPackageName rather than hardcoded: the bundle id is configuration,
    // and hardcoding it would mean a rename silently stops finding the service.
    let pkg = env
        .call_method(
            context.as_obj(),
            "getPackageName",
            "()Ljava/lang/String;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("no package name: {e}"))?;
    let pkg: String = env
        .get_string(&JString::from(pkg))
        .map_err(|e| e.to_string())?
        .into();

    // setClassName(Context, String) instead of Intent(Context, Class): naming the class
    // as a string avoids a find_class on a slash-separated path built from the package.
    let intent = env
        .new_object("android/content/Intent", "()V", &[])
        .map_err(|e| format!("no Intent: {e}"))?;
    let class_name = env
        .new_string(format!("{pkg}.TransferService"))
        .map_err(|e| e.to_string())?;
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

    // startForegroundService, not startService: API 26+ refuses to start a plain
    // background service, and this is the call that promises we'll reach
    // startForeground() within a few seconds (TransferService does it first thing).
    let (method, sig) = if on {
        (
            "startForegroundService",
            "(Landroid/content/Intent;)Landroid/content/ComponentName;",
        )
    } else {
        ("stopService", "(Landroid/content/Intent;)Z")
    };
    let called = env.call_method(context.as_obj(), method, sig, &[JValue::Object(&intent)]);

    // A pending exception poisons every later JNI call on this thread, so clear it before
    // returning — the SAF and MediaStore paths share this thread.
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err(format!("{method} threw"));
    }
    called.map(|_| ()).map_err(|e| format!("{method}: {e}"))
}
