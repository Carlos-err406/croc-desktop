//! Publishing received files to the device's Downloads folder via MediaStore.
//!
//! croc writes into the app's private data dir — there is no public path a
//! subprocess can be pointed at, and no folder picker that returns one. That's fine
//! for the transfer, but it strands the result: app-private storage isn't visible to
//! the Files app, the gallery, or any share sheet, so a received photo could be
//! received and then never seen again.
//!
//! MediaStore is the way out that needs no permission at all: an app may always
//! insert its own items into `MediaStore.Downloads` on API 29+. Each received file is
//! copied there under `Download/CrocMobile/` and the private copy is deleted, so the app dir
//! is a staging area rather than a black hole.
//!
//! The insert uses `IS_PENDING=1` while the bytes are written and clears it at the
//! end, so nothing else sees a half-written file — and a crash mid-copy leaves an
//! item the system reaps rather than a corrupt "download".
//!
//! API 26–28 have no `RELATIVE_PATH`/`IS_PENDING` and would need
//! WRITE_EXTERNAL_STORAGE plus a runtime prompt to reach public storage. Those
//! releases get `Unsupported` instead, and files stay where they are.

use std::io::Read;
use std::path::Path;

use jni::objects::{JByteArray, JObject, JValue};
use jni::JNIEnv;

/// Where exports land, relative to the shared storage root. MediaStore requires the
/// leading "Download/" for the Downloads collection.
const RELATIVE_PATH: &str = "Download/CrocMobile/";

pub enum Exported {
    /// Copied to Downloads. MediaStore de-duplicates collisions itself by appending
    /// "(1)", so a repeat transfer never overwrites an earlier one.
    Saved,
    /// Nothing was copied and the file is untouched: too old an Android, or JNI
    /// isn't available. The caller keeps showing the app-private location.
    Unsupported,
}

/// Copy `src` into `Download/CrocMobile/<sub_dir>/`. `sub_dir` mirrors the layout of a
/// received folder so a multi-file transfer doesn't flatten into one directory (and
/// two files called `IMG_0001.jpg` from different folders don't collide). On success
/// the caller may delete `src`.
pub fn export_to_downloads(src: &Path, sub_dir: &str, name: &str) -> Result<Exported, String> {
    let Some(vm) = crate::android_saf::vm() else {
        return Ok(Exported::Unsupported); // nativeInit never ran
    };
    let Some(context) = crate::android_saf::context() else {
        return Ok(Exported::Unsupported);
    };
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;

    if sdk_int(&mut env).unwrap_or(0) < 29 {
        return Ok(Exported::Unsupported);
    }

    let resolver = env
        .call_method(
            context.as_obj(),
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("no ContentResolver: {e}"))?;

    let collection = env
        .get_static_field(
            "android/provider/MediaStore$Downloads",
            "EXTERNAL_CONTENT_URI",
            "Landroid/net/Uri;",
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("no Downloads collection: {e}"))?;

    let values = new_content_values(&mut env, name, &mime_for(name), sub_dir)?;
    let item = env
        .call_method(
            &resolver,
            "insert",
            "(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;",
            &[JValue::Object(&collection), JValue::Object(&values)],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("couldn't create the download entry: {e}"))?;
    if item.is_null() {
        return Err("couldn't create the download entry".into());
    }

    // From here on a failure must not leave a permanently pending item behind:
    // delete it rather than leaving a zero-byte "download" the user can't clear.
    match copy_into(&mut env, &resolver, &item, src) {
        Ok(()) => {}
        Err(e) => {
            let _ = delete_item(&mut env, &resolver, &item);
            return Err(e);
        }
    }

    clear_pending(&mut env, &resolver, &item)?;
    Ok(Exported::Saved)
}

/// Whether a finished receive can actually be published to Downloads on this
/// device. False on API 26-28 (no RELATIVE_PATH/IS_PENDING) or if `nativeInit`
/// never ran — the UI must not promise a destination we can't deliver.
pub fn exports_supported() -> bool {
    let Some(vm) = crate::android_saf::vm() else {
        return false;
    };
    let Ok(mut env) = vm.attach_current_thread() else {
        return false;
    };
    sdk_int(&mut env).unwrap_or(0) >= 29
}

/// Where published files land, for the UI to show. Matches RELATIVE_PATH.
pub const DOWNLOADS_LABEL: &str = "Download/CrocMobile";

fn sdk_int(env: &mut JNIEnv) -> Option<i32> {
    env.get_static_field("android/os/Build$VERSION", "SDK_INT", "I")
        .ok()?
        .i()
        .ok()
}

/// `ContentValues` describing the new item, pending until the bytes are written.
fn new_content_values<'a>(
    env: &mut JNIEnv<'a>,
    name: &str,
    mime: &str,
    sub_dir: &str,
) -> Result<JObject<'a>, String> {
    let values = env
        .new_object("android/content/ContentValues", "()V", &[])
        .map_err(|e| e.to_string())?;
    put_string(env, &values, "_display_name", name)?;
    put_string(env, &values, "mime_type", mime)?;
    put_string(env, &values, "relative_path", &relative_path(sub_dir))?;
    put_int(env, &values, "is_pending", 1)?;
    Ok(values)
}

/// `Download/CrocMobile/<sub_dir>/`, with anything that could escape it stripped — the
/// sender chose these names, so they're untrusted input.
fn relative_path(sub_dir: &str) -> String {
    let safe: Vec<&str> = sub_dir
        .split(['/', '\\'])
        .map(str::trim)
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .collect();
    if safe.is_empty() {
        RELATIVE_PATH.to_string()
    } else {
        format!("{RELATIVE_PATH}{}/", safe.join("/"))
    }
}

fn put_string(env: &mut JNIEnv, values: &JObject, key: &str, value: &str) -> Result<(), String> {
    let k = env.new_string(key).map_err(|e| e.to_string())?;
    let v = env.new_string(value).map_err(|e| e.to_string())?;
    env.call_method(
        values,
        "put",
        "(Ljava/lang/String;Ljava/lang/String;)V",
        &[JValue::Object(&k), JValue::Object(&v)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn put_int(env: &mut JNIEnv, values: &JObject, key: &str, value: i32) -> Result<(), String> {
    let k = env.new_string(key).map_err(|e| e.to_string())?;
    // ContentValues.put takes a boxed Integer, not an int.
    let boxed = env
        .call_static_method(
            "java/lang/Integer",
            "valueOf",
            "(I)Ljava/lang/Integer;",
            &[JValue::Int(value)],
        )
        .and_then(|v| v.l())
        .map_err(|e| e.to_string())?;
    env.call_method(
        values,
        "put",
        "(Ljava/lang/String;Ljava/lang/Integer;)V",
        &[JValue::Object(&k), JValue::Object(&boxed)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Stream the file into the MediaStore item. Chunked through a reused Java byte
/// array: a received file can be gigabytes, and this must stay a disk-to-disk copy.
fn copy_into(
    env: &mut JNIEnv,
    resolver: &JObject,
    item: &JObject,
    src: &Path,
) -> Result<(), String> {
    const CHUNK: usize = 256 * 1024;

    let mut file = std::fs::File::open(src).map_err(|e| format!("can't read {src:?}: {e}"))?;
    let stream = env
        .call_method(
            resolver,
            "openOutputStream",
            "(Landroid/net/Uri;)Ljava/io/OutputStream;",
            &[JValue::Object(item)],
        )
        .and_then(|v| v.l())
        .map_err(|e| format!("couldn't open the download for writing: {e}"))?;
    if stream.is_null() {
        return Err("couldn't open the download for writing".into());
    }

    let buffer: JByteArray = env
        .new_byte_array(CHUNK as i32)
        .map_err(|e| e.to_string())?;
    let mut chunk = vec![0u8; CHUNK];

    let result = (|| -> Result<(), String> {
        loop {
            let read = file.read(&mut chunk).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            // i8 vs u8 is a representation difference only; the bytes are identical.
            let signed =
                unsafe { std::slice::from_raw_parts(chunk.as_ptr() as *const i8, read) };
            env.set_byte_array_region(&buffer, 0, signed)
                .map_err(|e| e.to_string())?;
            env.call_method(
                &stream,
                "write",
                "([BII)V",
                &[JValue::Object(&buffer), JValue::Int(0), JValue::Int(read as i32)],
            )
            .map_err(|e| format!("write failed: {e}"))?;
        }
        env.call_method(&stream, "flush", "()V", &[])
            .map_err(|e| e.to_string())?;
        Ok(())
    })();

    // Close either way — an unclosed stream keeps the item locked.
    let _ = env.call_method(&stream, "close", "()V", &[]);
    result
}

fn clear_pending(env: &mut JNIEnv, resolver: &JObject, item: &JObject) -> Result<(), String> {
    let values = env
        .new_object("android/content/ContentValues", "()V", &[])
        .map_err(|e| e.to_string())?;
    put_int(env, &values, "is_pending", 0)?;
    let null = JObject::null();
    env.call_method(
        resolver,
        "update",
        "(Landroid/net/Uri;Landroid/content/ContentValues;Ljava/lang/String;[Ljava/lang/String;)I",
        &[
            JValue::Object(item),
            JValue::Object(&values),
            JValue::Object(&null),
            JValue::Object(&null),
        ],
    )
    .map_err(|e| format!("couldn't publish the download: {e}"))?;
    Ok(())
}

fn delete_item(env: &mut JNIEnv, resolver: &JObject, item: &JObject) -> Result<(), String> {
    let null = JObject::null();
    env.call_method(
        resolver,
        "delete",
        "(Landroid/net/Uri;Ljava/lang/String;[Ljava/lang/String;)I",
        &[
            JValue::Object(item),
            JValue::Object(&null),
            JValue::Object(&null),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// A best-effort MIME type. MediaStore accepts anything, but the type is what makes
/// the gallery show an image and the Files app offer the right "open with".
fn mime_for(name: &str) -> String {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "opus" => "audio/ogg",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "txt" | "log" | "md" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "xml" => "text/xml",
        "html" | "htm" => "text/html",
        "apk" => "application/vnd.android.package-archive",
        _ => "application/octet-stream",
    };
    mime.to_string()
}
