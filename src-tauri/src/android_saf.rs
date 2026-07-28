//! Resolving a Storage Access Framework `content://` URI to its real display name.
//!
//! Android's picker returns an opaque document URI — for a MediaStore pick that's
//! something like `content://…/document/msf%3A10000210694`, which contains no
//! filename at all. Parsing the URI text can therefore never recover the name: the
//! staged copy ends up called `msf%3A10000210694` with no extension, so the peer
//! receives a file it can't open and the UI shows a "FILE" badge instead of "SVG".
//!
//! tauri-plugin-dialog's Kotlin side already knows the answer — `FilePickerUtils`
//! has `getNameFromUri`, which queries `OpenableColumns.DISPLAY_NAME` — but its
//! `showFilePicker` returns only an array of URI strings
//! (`createPickFilesResult`), and the Rust side deserializes them into bare
//! `FilePath`s. The name is resolved and then thrown away, so we have to ask the
//! ContentResolver ourselves.
//!
//! Nothing in this dependency tree initialises `ndk_context`, and wry keeps its
//! `JavaVM` private, so the VM and Context are captured from Kotlin instead:
//! `MainActivity.onCreate` calls `nativeInit` (added by
//! scripts/android-configure.mjs) once the native library is loaded.

use std::sync::OnceLock;

use jni::objects::{GlobalRef, JClass, JObject, JString, JValue};
use jni::{JNIEnv, JavaVM};

static VM: OnceLock<JavaVM> = OnceLock::new();
static CONTEXT: OnceLock<GlobalRef> = OnceLock::new();

/// Called once from `MainActivity.onCreate`, AFTER `super.onCreate` — the native
/// library isn't loaded before that, so calling it earlier would abort.
///
/// The symbol name encodes the package, which must stay in step with
/// `identifier` in tauri.conf.json (`dev.carlosd.crocdesktop`). If that identifier
/// ever changes, Kotlin will throw `UnsatisfiedLinkError` at startup — caught on the
/// Kotlin side so a rename degrades to "no display names" rather than a crash.
#[no_mangle]
pub extern "system" fn Java_dev_carlosd_crocdesktop_MainActivity_nativeInit(
    env: JNIEnv,
    _class: JClass,
    context: JObject,
) {
    if let Ok(vm) = env.get_java_vm() {
        let _ = VM.set(vm);
    }
    // A global ref: the local one dies when this call returns.
    if let Ok(global) = env.new_global_ref(context) {
        let _ = CONTEXT.set(global);
    }
}

/// The user-facing filename for a `content://` URI, via
/// `ContentResolver.query(uri, [DISPLAY_NAME], …)`.
///
/// Returns `None` for anything unexpected — a missing VM (nativeInit never ran), a
/// provider that reports no name, or any JNI failure — so the caller can fall back
/// to its URI heuristic rather than fail the pick.
pub fn display_name(uri: &str) -> Option<String> {
    let vm = VM.get()?;
    let context = CONTEXT.get()?;
    let mut env = vm.attach_current_thread().ok()?;

    let resolver = env
        .call_method(
            context.as_obj(),
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )
        .ok()?
        .l()
        .ok()?;

    let uri_string = env.new_string(uri).ok()?;
    let parsed = env
        .call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&uri_string)],
        )
        .ok()?
        .l()
        .ok()?;

    // Null projection: some providers ignore a projection and return their own
    // columns, so ask for everything and look the column up by name below.
    let null = JObject::null();
    let cursor = env
        .call_method(
            &resolver,
            "query",
            "(Landroid/net/Uri;[Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;)Landroid/database/Cursor;",
            &[
                JValue::Object(&parsed),
                JValue::Object(&null),
                JValue::Object(&null),
                JValue::Object(&null),
                JValue::Object(&null),
            ],
        )
        .ok()?
        .l()
        .ok()?;
    if cursor.is_null() {
        return None;
    }

    let name = read_display_name(&mut env, &cursor);
    // Close even on the failure paths — a leaked cursor logs a loud
    // "finalized without prior close()" and can exhaust the provider's cursors.
    let _ = env.call_method(&cursor, "close", "()V", &[]);
    name
}

fn read_display_name(env: &mut JNIEnv, cursor: &JObject) -> Option<String> {
    if !env.call_method(cursor, "moveToFirst", "()Z", &[]).ok()?.z().ok()? {
        return None;
    }

    let column = env.new_string("_display_name").ok()?;
    let index = env
        .call_method(
            cursor,
            "getColumnIndex",
            "(Ljava/lang/String;)I",
            &[JValue::Object(&column)],
        )
        .ok()?
        .i()
        .ok()?;
    if index < 0 {
        return None;
    }

    let value = env
        .call_method(cursor, "getString", "(I)Ljava/lang/String;", &[JValue::Int(index)])
        .ok()?
        .l()
        .ok()?;
    if value.is_null() {
        return None;
    }

    let name: String = env.get_string(&JString::from(value)).ok()?.into();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
