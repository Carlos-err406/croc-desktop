//! The `WifiManager.MulticastLock` that makes mDNS work on Android.
//!
//! Without it, Android drops multicast packets whenever Wi-Fi power-save kicks in — and it
//! does so *silently*: `mdns-sd` starts, joins the group, sends its queries and simply never
//! hears an answer. That's why nearby was desktop-only rather than shipped half-working.
//!
//! The lock object itself has to be kept alive to be released later, so it's held in a
//! `GlobalRef`. Acquiring is idempotent, and releasing is only safe once nothing is using
//! multicast — `nearby.rs` owns that decision.

use jni::objects::{GlobalRef, JValue};
use std::sync::Mutex;

static LOCK: Mutex<Option<GlobalRef>> = Mutex::new(None);

/// Take the lock so multicast survives Wi-Fi power-save. Idempotent.
pub fn acquire() -> Result<(), String> {
    let mut held = LOCK.lock().unwrap();
    if held.is_some() {
        return Ok(());
    }

    let vm = crate::android_saf::vm().ok_or("nativeInit never ran, so there's no JavaVM")?;
    let context = crate::android_saf::context().ok_or("no app Context")?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;

    // WIFI_SERVICE must come from the *application* context: getting it from an Activity
    // leaks the Activity, which Android warns about loudly.
    let app_ctx = env
        .call_method(
            context.as_obj(),
            "getApplicationContext",
            "()Landroid/content/Context;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("no application context: {e}"))?;
    let name = env.new_string("wifi").map_err(|e| e.to_string())?;
    let wifi = env
        .call_method(
            &app_ctx,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[JValue::Object(&name)],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("no WifiManager: {e}"))?;
    if wifi.is_null() {
        return Err("this device has no WifiManager".into());
    }

    let tag = env.new_string("croc-nearby").map_err(|e| e.to_string())?;
    let lock = env
        .call_method(
            &wifi,
            "createMulticastLock",
            "(Ljava/lang/String;)Landroid/net/wifi/WifiManager$MulticastLock;",
            &[JValue::Object(&tag)],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("createMulticastLock: {e}"))?;

    // Not reference counted: this module keeps exactly one lock, and a mismatched
    // acquire/release pair on a counted lock throws instead of just being wrong.
    env.call_method(&lock, "setReferenceCounted", "(Z)V", &[JValue::Bool(0)])
        .map_err(|e| format!("setReferenceCounted: {e}"))?;
    env.call_method(&lock, "acquire", "()V", &[])
        .map_err(|e| format!("acquire: {e}"))?;

    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err(
            "the multicast lock was refused (is CHANGE_WIFI_MULTICAST_STATE declared?)".into(),
        );
    }

    *held = Some(
        env.new_global_ref(&lock)
            .map_err(|e| format!("global ref: {e}"))?,
    );
    Ok(())
}

/// Give the lock back. A no-op if we aren't holding one.
pub fn release() {
    let Some(lock) = LOCK.lock().unwrap().take() else {
        return;
    };
    let Some(vm) = crate::android_saf::vm() else {
        return;
    };
    let Ok(mut env) = vm.attach_current_thread() else {
        return;
    };
    let _ = env.call_method(lock.as_obj(), "release", "()V", &[]);
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
    }
}
