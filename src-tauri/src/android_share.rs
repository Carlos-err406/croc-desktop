//! Receiving Android's share sheet: `ACTION_SEND` / `ACTION_SEND_MULTIPLE`.
//!
//! The manifest advertises Croc as a share target, so the app shows up when you
//! share a photo from Gallery or a link from a browser. tauri-plugin-deep-link only
//! handles `ACTION_VIEW`, so the payload has to come across from Kotlin: MainActivity
//! calls `nativeShare` (added by scripts/android-configure.mjs) from both `onCreate`
//! and `onNewIntent`.
//!
//! What arrives is a list of `content://` URIs, exactly like the file picker's
//! output — but they can't be staged here. The URIs are queued raw and copied when
//! the frontend drains them, because staging can fail for reasons the user should
//! see (no space, an unreadable cloud provider) and a JNI callback has nowhere to
//! report that. `croc_take_shared` does the copying and returns a Result.
//!
//! The read permission the sharing app grants lives as long as this activity's task,
//! and the frontend drains on mount and on resume, so the copy always happens well
//! inside that window.

use std::sync::{Mutex, OnceLock};

use jni::objects::{JClass, JObjectArray, JString};
use jni::sys::jsize;
use jni::JNIEnv;
use tauri::{AppHandle, Emitter};

/// One share-sheet delivery, queued until the frontend asks for it.
#[derive(Default)]
pub struct Shared {
    /// `content://` URIs to stage and send.
    pub uris: Vec<String>,
    /// Shared text (a link, a snippet) when no files came with it.
    pub text: Option<String>,
}

static QUEUE: Mutex<Option<Shared>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();

/// Remember the handle so a share arriving while the app runs can wake the UI.
/// Called from `setup`; a cold-start share is picked up by the frontend's own drain
/// on mount instead, which is why a missing handle is never fatal here.
pub fn set_app_handle(app: AppHandle) {
    let _ = APP.set(app);
}

/// Take everything shared so far, leaving the queue empty.
pub fn take() -> Shared {
    QUEUE.lock().unwrap().take().unwrap_or_default()
}

/// Called from `MainActivity.onCreate`/`onNewIntent` for a SEND intent.
///
/// See android_saf.rs for why the symbol name encodes the package. Kotlin wraps the
/// call in `runCatching`, so a rename degrades to "sharing does nothing" rather than
/// a crash on launch.
#[no_mangle]
pub extern "system" fn Java_dev_carlosd_crocdesktop_MainActivity_nativeShare(
    mut env: JNIEnv,
    _class: JClass,
    uris: JObjectArray,
    text: JString,
) {
    let mut shared = Shared::default();

    if !uris.is_null() {
        let len = env.get_array_length(&uris).unwrap_or(0);
        for i in 0..len as jsize {
            let Ok(item) = env.get_object_array_element(&uris, i) else {
                continue;
            };
            if item.is_null() {
                continue;
            }
            if let Ok(s) = env.get_string(&JString::from(item)) {
                shared.uris.push(s.into());
            }
        }
    }

    if !text.is_null() {
        if let Ok(s) = env.get_string(&text) {
            let s: String = s.into();
            if !s.trim().is_empty() {
                shared.text = Some(s);
            }
        }
    }

    if shared.uris.is_empty() && shared.text.is_none() {
        return;
    }

    // Append: two shares in quick succession (or one before the UI has drained the
    // last) must not lose the first.
    {
        let mut slot = QUEUE.lock().unwrap();
        match slot.as_mut() {
            Some(pending) => {
                pending.uris.extend(shared.uris);
                // Last text wins — two shared links can't both fill one text box.
                if shared.text.is_some() {
                    pending.text = shared.text;
                }
            }
            None => *slot = Some(shared),
        }
    }

    if let Some(app) = APP.get() {
        let _ = app.emit("croc://shared", ());
    }
}
