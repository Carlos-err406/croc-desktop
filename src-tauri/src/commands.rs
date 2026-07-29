//! Tauri commands — the Rust port of electron/ipc/croc/main.ts.
use crate::codephrase;
use crate::croc::{self, CrocReceiveResult, CrocSendResult, ReceiveCommand, StatEntry};
use crate::history::{self, HistoryDraft, HistoryEntry};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Files handed to the app by the OS ("Open With → Croc Desktop" / drag onto the
/// dock icon), buffered until the frontend drains them via croc_take_opened_files.
#[derive(Default)]
pub struct OpenedPaths(pub Mutex<Vec<String>>);

/// Drain any files the OS asked us to open, so the UI can stage them to send.
#[tauri::command]
pub fn croc_take_opened_files(state: State<OpenedPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// The extra croc flags a CLI receiver needs to match this send's embedded
/// settings — appended to the copyable `CROC_SECRET=… croc` command so a terminal
/// user lines up with the QR/link. `--local` (LAN-only) ignores the relay, mirroring
/// how the app builds its own args.
fn recv_flags(local: bool, relay: &Option<String>) -> String {
    if local {
        " --local".into()
    } else if let Some(r) = relay.as_deref().filter(|s| !s.is_empty()) {
        format!(" --relay {r}")
    } else {
        String::new()
    }
}

fn gen_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{now}-{}", rand::random::<u32>())
}

/// ~/Downloads/Croc (created if missing).
///
/// On Android there is no user-writable Downloads path an exec'd binary can use:
/// public storage is mediated by MediaStore/SAF, which croc knows nothing about.
/// Receives therefore land in the app's own data dir — writable with no permission
/// and removed on uninstall — and `croc_export_received` republishes them to
/// `Download/CrocMobile` once the transfer finishes, so nothing is stranded there.
#[cfg(desktop)]
fn default_download_dir(app: &AppHandle) -> String {
    let base = app
        .path()
        .download_dir()
        .ok()
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| PathBuf::from(h).join("Downloads"))
        })
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("Croc");
    let _ = std::fs::create_dir_all(&dir);
    dir.to_string_lossy().into_owned()
}

#[cfg(mobile)]
fn default_download_dir(app: &AppHandle) -> String {
    let dir = app
        .path()
        .app_data_dir()
        .map(|d| d.join("Croc"))
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    dir.to_string_lossy().into_owned()
}

/// `HOME` for the croc child on Android: croc persists config (including the
/// `--internal-dns` marker) relative to it, and an unset HOME sends those writes
/// somewhere the sandbox denies.
#[cfg(mobile)]
pub fn android_home_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("croc-home");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// `TMPDIR` for the croc child on Android.
#[cfg(mobile)]
pub fn android_tmp_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("croc-tmp");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// A per-transfer scratch directory to use as croc's cwd.
///
/// MUST NOT be `std::env::temp_dir()` on Android: that reads `$TMPDIR`, which an
/// Android app process doesn't set, so it falls back to `/tmp` — a path that doesn't
/// exist there. croc would then be spawned with a cwd it can't enter and every file
/// send would fail with ENOENT. App-private cache is the writable equivalent.
///
/// Errors are returned rather than swallowed: a scratch dir we couldn't create is a
/// send that cannot work, and "couldn't create a working folder" beats croc failing
/// later for a reason the user can't act on.
fn scratch_dir(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    #[cfg(desktop)]
    let base = {
        let _ = app;
        std::env::temp_dir()
    };
    #[cfg(mobile)]
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("croc-scratch");

    let dir = base.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create a working folder: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn croc_default_dir(app: AppHandle) -> String {
    default_download_dir(&app)
}

/// Where the user should be told their files go — NOT necessarily where croc
/// writes them.
///
/// On Android those differ: croc can only write to app-private storage, and the
/// files are republished to Download/CrocMobile when the transfer finishes. Showing
/// the path croc uses ("/data/user/0/dev.carlosd.crocdesktop/Croc") names a place
/// the user cannot open and isn't where the files end up. Falls back to the real
/// path on API 26-28, where publishing isn't available and the files really do stay
/// put. Everywhere else the two are the same thing.
#[tauri::command]
pub fn croc_save_location(app: AppHandle) -> String {
    #[cfg(target_os = "android")]
    if crate::android_media::exports_supported() {
        return crate::android_media::DOWNLOADS_LABEL.to_string();
    }
    default_download_dir(&app)
}

/// Android has no signed-updater artifact to size up, and reqwest is desktop-only
/// here (its TLS backend needs a C toolchain for the Android target), so this
/// reports "unknown" and the UI omits the size. Kept as a command on every
/// platform so the frontend contract doesn't fork.
#[cfg(mobile)]
#[tauri::command]
pub async fn croc_update_size() -> Option<u64> {
    None
}

/// Size in bytes of the pending update's download for THIS platform, so the UI can
/// show it before the user commits. Reads the updater manifest, picks the platform
/// key (Rust knows os+arch exactly), and HEADs the asset. Best-effort → None on any
/// failure (GitHub asset responses have no CORS headers, so this can't be done from
/// the webview with fetch; hence a Rust request). Content-Length survives the 302.
#[cfg(desktop)]
#[tauri::command]
pub async fn croc_update_size() -> Option<u64> {
    // Same manifest as plugins.updater.endpoints in tauri.conf.json.
    const MANIFEST: &str =
        "https://github.com/Carlos-err406/croc-gui/releases/latest/download/latest.json";
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let key = format!("{}-{}", os, std::env::consts::ARCH); // e.g. darwin-aarch64, linux-x86_64
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;
    let body = client.get(MANIFEST).send().await.ok()?.text().await.ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&body).ok()?;
    let url = manifest
        .get("platforms")?
        .get(&key)?
        .get("url")?
        .as_str()?
        .to_string();

    // Prefer HEAD's Content-Length. But reqwest's content_length() can return None
    // for a HEAD (it reads the empty body, not the header), so fall back to a ranged
    // GET and parse the total out of `Content-Range: bytes 0-0/<total>` — 1 byte,
    // rock-solid on GitHub's asset CDN.
    if let Ok(resp) = client.head(&url).send().await {
        if let Some(n) = resp.content_length().filter(|n| *n > 0) {
            return Some(n);
        }
    }
    let resp = client
        .get(&url)
        .header("Range", "bytes=0-0")
        .send()
        .await
        .ok()?;
    let total = resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit('/').next())
        .and_then(|n| n.trim().parse::<u64>().ok());
    total.or_else(|| resp.content_length().filter(|n| *n > 0))
}

/// Deep links are emitted to EVERY window (`app.emit` broadcasts), so with more than
/// one window open they'd each start the same receive — and croc rooms are 1:1, so the
/// losers fail with "room full". This lets exactly one window claim a URL: the first
/// caller gets `true`, repeats of the same URL within a short window get `false`.
/// Time-boxed rather than permanent so genuinely re-clicking a link later still works.
#[derive(Default)]
pub struct ClaimedUrls(pub Mutex<Option<(String, std::time::Instant)>>);

#[tauri::command]
pub fn croc_claim_url(state: State<ClaimedUrls>, url: String) -> bool {
    const DEDUPE_WINDOW: std::time::Duration = std::time::Duration::from_secs(3);
    let mut last = state.0.lock().unwrap();
    if let Some((prev, at)) = last.as_ref() {
        if prev == &url && at.elapsed() < DEDUPE_WINDOW {
            return false; // another window already took this one
        }
    }
    *last = Some((url, std::time::Instant::now()));
    true
}

/// Open another app window in THIS instance, so several transfers can run at once
/// (the app tracks one send + one receive per window). Built in Rust rather than
/// from JS so it needs no window-creation permission; the new label matches the
/// `win-*` pattern in capabilities/default.json, which is what grants the new
/// window its IPC permissions — without that it would load but every call would fail.
#[cfg(mobile)]
#[tauri::command]
pub fn croc_new_window(_app: AppHandle) -> Result<String, String> {
    Err("Multiple windows aren't available on this platform.".into())
}

#[cfg(desktop)]
#[tauri::command]
pub fn croc_new_window(app: AppHandle) -> Result<String, String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    // Unique, capability-matching label.
    let label = format!(
        "win-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("Croc Desktop")
        .inner_size(1120.0, 720.0)
        .min_inner_size(940.0, 640.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

/// A "send to me" invite: the code the receiver will wait on, plus the QR and links
/// that put a scanner straight into its Send screen (reverse pairing).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrocInvite {
    pub code: String,
    pub qr: Option<String>,
    pub deeplink: String,
    pub link: String,
}

/// Mint (or reuse) a code and build the "send to me" QR + links for it. Reusing the
/// caller's code keeps a code the user already typed/bookmarked, so the invite and
/// the receive they start are the same transfer.
#[tauri::command]
pub fn croc_invite(code: Option<String>) -> CrocInvite {
    let code = match code {
        Some(c) if c.trim().len() >= 6 => c.trim().to_string(),
        _ => codephrase::generate_code(),
    };
    let deeplink = croc::send_deeplink(&code);
    CrocInvite {
        qr: croc::generate_qr_data_url(&deeplink),
        link: croc::send_link(&code),
        deeplink,
        code,
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrocInfo {
    pub path: Option<String>,
    pub version: Option<String>,
    pub bundled: bool,
    /// The croc version the app expects to bundle (for the UI to flag a mismatch).
    pub expected_version: String,
    /// True when the resolved croc looks compatible with peers on the bundled
    /// version: it's the bundled sidecar, or its version string contains the
    /// expected version. False → likely a system croc that may break transfers.
    pub compatible: bool,
}

/// Which croc binary the app resolved, whether it's the bundled sidecar, and its version.
#[tauri::command]
pub fn croc_info() -> CrocInfo {
    let resolved = croc::find_croc_binary();
    // On Android croc is ALWAYS the one we ship: it's packaged in the APK as
    // jniLibs/<abi>/libcroc.so and reached through CROC_BIN. There is no sidecar
    // and no system croc to compare against, so the desktop comparison would report
    // "System croc" and make a correct install look misconfigured.
    #[cfg(mobile)]
    let bundled = resolved.is_some();
    #[cfg(desktop)]
    let bundled = matches!(
        (&resolved, croc::bundled_croc_binary()),
        (Some(r), Some(b)) if r == &b
    );
    let version = resolved.as_ref().and_then(|p| {
        std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    });
    // Compatible if it's the bundled sidecar, or its reported version matches what
    // we expect to bundle. A resolved-but-unknown version is treated as compatible
    // (don't cry wolf when `--version` simply couldn't be read).
    //
    // Compare WITHOUT the leading "v": croc is inconsistent about it — 10.4.14
    // printed "croc version v10.4.14" but 10.6.0 prints "croc version 10.6.0" — so a
    // literal substring match on "v10.6.0" would wrongly flag a matching system croc.
    let want = croc::EXPECTED_CROC_VERSION.trim_start_matches('v');
    let compatible = bundled || version.as_deref().map(|v| v.contains(want)).unwrap_or(true);
    CrocInfo {
        path: resolved.map(|p| p.to_string_lossy().into_owned()),
        version,
        bundled,
        expected_version: croc::EXPECTED_CROC_VERSION.to_string(),
        compatible,
    }
}

#[tauri::command]
pub fn croc_stat_paths(paths: Vec<String>) -> Vec<StatEntry> {
    croc::stat_paths(paths)
}

// rfd can't pick files + folders in one dialog; this is a multi-file picker
// (folders are added via drag-drop). Async so the blocking dialog runs off the
// main thread.
#[cfg(desktop)]
#[tauri::command]
pub async fn croc_pick_paths(app: AppHandle) -> Result<Vec<String>, String> {
    // Result rather than Vec purely so both platforms present the same command
    // signature to the frontend; desktop picking can't fail this way.
    Ok(app
        .dialog()
        .file()
        .set_title("Choose files to send")
        .blocking_pick_files()
        .map(|files| {
            files
                .into_iter()
                .filter_map(|f| f.into_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default())
}

/// Android's picker hands back `content://` URIs from the Storage Access
/// Framework, and croc — an ordinary subprocess — can't open one. Each pick is
/// therefore STREAMED into a staging dir under the cache and croc is given the
/// copy's real path.
///
/// The copy is the unavoidable cost of SAF: it briefly doubles the space a send
/// needs. It's streamed rather than buffered so that cost is disk, never memory.
/// `croc_clear_staged` empties the dir once a send finishes.
#[cfg(mobile)]
#[tauri::command]
pub async fn croc_pick_paths(app: AppHandle) -> Result<Vec<String>, String> {
    let Some(files) = app.dialog().file().blocking_pick_files() else {
        return Ok(Vec::new()); // cancelled — deliberately distinct from a failure
    };
    // Collect into a Result so a half-finished pick reports WHY. Staging can fail for
    // reasons the user can act on (out of space, an unreadable cloud URI), and
    // silently returning fewer paths than they chose is the worst outcome.
    files
        .into_iter()
        .map(|f| stage_picked_file(&app, f))
        .collect()
}

/// Copy one picked file into the staging dir, returning its real path. Keeps the
/// display name so croc (and therefore the receiver) sees the original filename.
#[cfg(mobile)]
fn stage_picked_file(
    app: &AppHandle,
    picked: tauri_plugin_dialog::FilePath,
) -> Result<String, String> {
    use tauri_plugin_fs::{FsExt, OpenOptions};

    let name = display_name_for(&picked);
    // Each pick gets its own directory so the display name — which is what croc
    // transmits — is preserved even when two picks share a filename. Without this,
    // two files called IMG_0001.jpg collapse into one and the same path is returned
    // twice. croc_clear_staged removes the whole tree, so these nest harmlessly.
    let dir = staging_dir(app)?.join(gen_id());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&name);

    let mut opts = OpenOptions::new();
    opts.read(true);
    let mut src = app
        .fs()
        .open(picked, opts)
        .map_err(|e| format!("can't read the picked file: {e}"))?;
    let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    if let Err(e) = std::io::copy(&mut src, &mut out) {
        // A partial copy would otherwise be sent as if it were the whole file.
        drop(out);
        let _ = std::fs::remove_file(&dest);
        return Err(format!("couldn't copy \"{name}\" for sending: {e}"));
    }

    Ok(dest.to_string_lossy().into_owned())
}

/// Best-effort filename from a SAF URI. Content URIs commonly end in a
/// percent-encoded display name (…%2Fmovie.mp4) or a bare document id; anything
/// unusable falls back to a generated name so the send still works.
#[cfg(mobile)]
fn display_name_for(picked: &tauri_plugin_dialog::FilePath) -> String {
    let raw = picked.to_string();

    // Authoritative: ask the ContentResolver. A MediaStore pick's URI carries no
    // filename at all — it ends in a document id like `msf%3A10000210694`, which is
    // what the peer used to receive (with no extension, so the UI badged it "FILE").
    #[cfg(target_os = "android")]
    if let Some(name) = crate::android_saf::display_name(&raw) {
        return sanitize_component(&name);
    }

    // Fallback for anything the resolver can't answer.
    // Drop any query/fragment first, or a URI like …/IMG.jpg?x=1 stages under the
    // literal name "IMG.jpg?x=1".
    let path_part = raw.split(['?', '#']).next().unwrap_or(&raw);
    let decoded = percent_decode(path_part);
    let candidate = decoded
        .rsplit(['/', ':'])
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    let cleaned: String = candidate
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0'))
        .collect();
    let cleaned = cleaned.trim_matches('.').trim().to_string();

    // Media/photo-picker URIs end in a bare document id ("1000000123"), which is no
    // more meaningful to the receiver than a generated name. Anything else — even
    // without an extension — is likely the real display name, so keep it.
    // A ContentResolver DISPLAY_NAME query would be authoritative; see docs/android.md.
    let usable = !cleaned.is_empty() && !cleaned.chars().all(|c| c.is_ascii_digit());
    if usable {
        cleaned
    } else {
        format!("shared-{}", gen_id())
    }
}

/// Minimal percent-decoder for URI text. The previous hand-rolled version only
/// handled %2F and %20, so a document id like `msf%3A10000210694` kept its encoded
/// colon, never split on it, and became the filename verbatim.
#[cfg(mobile)]
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Strip anything that could escape the staging directory. A provider-supplied
/// display name is untrusted input: it reaches us from another app.
#[cfg(mobile)]
fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0'))
        .collect();
    match cleaned.trim_matches('.').trim() {
        "" => format!("shared-{}", gen_id()),
        s => s.to_string(),
    }
}

/// Where picked files are staged before sending: cache, so Android can evict it
/// under storage pressure rather than the app leaking space forever.
#[cfg(mobile)]
fn staging_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("croc-send");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// What Android's share sheet handed us: files (already staged to real paths) and,
/// when a share carried no files, its text.
#[derive(Default, serde::Serialize)]
pub struct SharedPayload {
    pub paths: Vec<String>,
    pub text: Option<String>,
}

/// Drain a share-sheet delivery, staging its `content://` URIs the same way a pick
/// is staged. Errors reach the UI: a share that silently drops a file is worse than
/// one that says why.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn croc_take_shared(app: AppHandle) -> Result<SharedPayload, String> {
    use std::str::FromStr;

    let shared = crate::android_share::take();
    let mut paths = Vec::with_capacity(shared.uris.len());
    for uri in shared.uris {
        // Infallible: anything that isn't a URI is treated as a plain path.
        let picked = tauri_plugin_dialog::FilePath::from_str(&uri).unwrap();
        paths.push(stage_picked_file(&app, picked)?);
    }
    Ok(SharedPayload {
        paths,
        text: shared.text,
    })
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn croc_take_shared(_app: AppHandle) -> Result<SharedPayload, String> {
    Ok(SharedPayload::default())
}

/// What happened to a finished receive's files.
#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// How many files were published to Downloads.
    pub saved: usize,
    /// Where they went, for the UI to show ("Download/CrocMobile"). `None` when nothing
    /// moved — the files are still at the receive path the UI already knows.
    pub location: Option<String>,
}

/// Publish a finished receive's files to `Download/CrocMobile` and drop the private
/// copies, so what arrived is reachable from the Files app and the gallery.
///
/// The whole receive directory is swept rather than a list of names: it holds
/// nothing but received files, so sweeping also picks up anything a previous run
/// failed to export instead of stranding it forever.
///
/// One file failing doesn't fail the batch — the rest still get out, and whatever
/// stayed behind is retried after the next receive.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn croc_export_received(out: String) -> Result<ExportResult, String> {
    use crate::android_media::{export_to_downloads, Exported};

    let root = PathBuf::from(&out);
    if !root.is_dir() {
        return Ok(ExportResult::default());
    }

    let mut saved = 0usize;
    let mut first_error: Option<String> = None;
    for (path, sub_dir) in files_under(&root) {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        match export_to_downloads(&path, &sub_dir, name) {
            // Only remove the private copy once the bytes are safely published.
            Ok(Exported::Saved) => {
                saved += 1;
                let _ = std::fs::remove_file(&path);
            }
            Ok(Exported::Unsupported) => return Ok(ExportResult::default()),
            Err(e) => {
                first_error.get_or_insert(format!("{name}: {e}"));
            }
        }
    }

    // Tidy the now-empty folders a received directory left behind.
    let _ = prune_empty_dirs(&root);

    match (saved, first_error) {
        (0, Some(e)) => Err(e),
        (_, _) => Ok(ExportResult {
            saved,
            location: (saved > 0).then(|| "Download/CrocMobile".to_string()),
        }),
    }
}

/// Every file under `root`, paired with its directory path relative to `root`.
#[cfg(target_os = "android")]
fn files_under(root: &std::path::Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &std::path::Path, rel: &str, out: &mut Vec<(PathBuf, String)>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let child = if rel.is_empty() {
                    name
                } else {
                    format!("{rel}/{name}")
                };
                walk(&path, &child, out);
            } else if path.is_file() {
                out.push((path, rel.to_string()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, "", &mut out);
    out
}

/// Remove directories left empty by the export, deepest first. `root` itself stays:
/// it's the receive destination and croc expects it to exist.
#[cfg(target_os = "android")]
fn prune_empty_dirs(root: &std::path::Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(root)?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let _ = prune_empty_dirs(&path);
            let _ = std::fs::remove_dir(&path); // fails harmlessly if not empty
        }
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn croc_export_received(_out: String) -> Result<ExportResult, String> {
    Ok(ExportResult::default())
}

/// Drop everything staged for sending. Called when a send finishes or resets; the
/// copies only exist to hand croc a readable path.
#[cfg(mobile)]
#[tauri::command]
pub fn croc_clear_staged(app: AppHandle) {
    if let Ok(dir) = staging_dir(&app) {
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(desktop)]
#[tauri::command]
pub fn croc_clear_staged(_app: AppHandle) {}

#[cfg(desktop)]
#[tauri::command]
pub async fn croc_pick_folder(app: AppHandle) -> String {
    app.dialog()
        .file()
        .set_title("Choose a download folder")
        .blocking_pick_folder()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

// Pick folders to send. rfd can't offer files + folders in one native dialog, so
// folder sending needs its own picker (previously folders could only be drag-dropped,
// which the GTK/Linux file chooser in "Browse files…" doesn't allow at all).
/// SAF has no picker that yields a *path* for a directory — only a tree URI, which
/// croc can't write into. Receives always land in the app's own folder, and an
/// empty string tells the UI to keep using that default.
#[cfg(mobile)]
#[tauri::command]
pub async fn croc_pick_folder(_app: AppHandle) -> String {
    String::new()
}

#[cfg(desktop)]
#[tauri::command]
pub async fn croc_pick_folders(app: AppHandle) -> Vec<String> {
    app.dialog()
        .file()
        .set_title("Choose folders to send")
        .blocking_pick_folders()
        .map(|folders| {
            folders
                .into_iter()
                .filter_map(|f| f.into_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// Same SAF limitation as `croc_pick_folder`: a tree URI isn't a path, so sending
/// a folder would mean walking and staging it file by file. Not in this version —
/// the UI hides the folder button on Android.
#[cfg(mobile)]
#[tauri::command]
pub async fn croc_pick_folders(_app: AppHandle) -> Vec<String> {
    Vec::new()
}

#[tauri::command]
pub fn croc_send(
    app: AppHandle,
    paths: Vec<String>,
    transfer_id: Option<String>,
    relay: Option<String>,
    zip: Option<bool>,
    code: Option<String>,
    local: Option<bool>,
) -> Result<CrocSendResult, String> {
    if paths.is_empty() {
        return Err("No files selected.".into());
    }
    let transfer_id = transfer_id.unwrap_or_else(gen_id);
    // Reuse the caller's code (e.g. re-sending with an extra file so the shared
    // code/QR stays valid); otherwise mint a fresh one. croc requires >= 6 chars.
    let code = match code {
        Some(c) if c.trim().len() >= 6 => c.trim().to_string(),
        _ => codephrase::generate_code(),
    };

    // Starts with any flags this platform always needs (Android: --internal-dns).
    let mut args: Vec<String> = croc::platform_global_flags();
    // Offline mode: `--local` (a global flag → before the subcommand) makes croc use
    // only a LAN relay + mDNS discovery, no public relay/internet. It ignores --relay,
    // so we skip it. Both peers must have this on and be on the same network.
    let local = local.unwrap_or(false);
    let custom_relay = relay.filter(|s| !s.is_empty()); // kept for the copy command too
    if local {
        args.push("--local".into());
    } else if let Some(r) = &custom_relay {
        args.push("--relay".into());
        args.push(croc::resolve_relay(r));
    }
    args.push("send".into());
    if zip.unwrap_or(false) {
        args.push("--zip".into());
    }
    args.extend(paths);

    // Give each send its own scratch cwd. croc drops a temp `<folder>.zip` here when
    // zipping a folder; isolating + wiping it (see spawn_transfer) stops a retry after
    // a failed transfer from tripping croc's "file already exists!" error.
    let work_dir = scratch_dir(&app, &format!("croc-send-{transfer_id}"))?;
    croc::spawn_transfer(
        app.clone(),
        transfer_id.clone(),
        args,
        code.clone(),
        Some(work_dir),
        false,
    )?;

    // Embed the send's local-only setting so the receiver auto-applies it.
    let qr = croc::generate_qr_data_url(&croc::receive_deeplink(&code, local));
    Ok(CrocSendResult {
        transfer_id,
        qr,
        receive_command: ReceiveCommand {
            code: code.clone(),
            posix: format!(
                "CROC_SECRET={code} croc{}",
                recv_flags(local, &custom_relay)
            ),
            interactive: "croc   # then paste the code when prompted".into(),
        },
        receive_link: croc::receive_link(&code, local),
        code,
    })
}

/// Send a text message (`croc send --text`) instead of files.
#[tauri::command]
pub fn croc_send_text(
    app: AppHandle,
    text: String,
    transfer_id: Option<String>,
    relay: Option<String>,
    code: Option<String>,
    local: Option<bool>,
) -> Result<CrocSendResult, String> {
    if text.is_empty() {
        return Err("Nothing to send.".into());
    }
    let transfer_id = transfer_id.unwrap_or_else(gen_id);
    let code = match code {
        Some(c) if c.trim().len() >= 6 => c.trim().to_string(),
        _ => codephrase::generate_code(),
    };

    // Starts with any flags this platform always needs (Android: --internal-dns).
    let mut args: Vec<String> = croc::platform_global_flags();
    // Offline mode: LAN-only, ignores --relay (see croc_send).
    let local = local.unwrap_or(false);
    let custom_relay = relay.filter(|s| !s.is_empty());
    if local {
        args.push("--local".into());
    } else if let Some(r) = &custom_relay {
        args.push("--relay".into());
        args.push(croc::resolve_relay(r));
    }
    args.push("send".into());
    args.push("--text".into());
    args.push(text);

    croc::spawn_transfer(
        app.clone(),
        transfer_id.clone(),
        args,
        code.clone(),
        None,
        false,
    )?;

    // Embed the send's local-only setting so the receiver auto-applies it.
    let qr = croc::generate_qr_data_url(&croc::receive_deeplink(&code, local));
    Ok(CrocSendResult {
        transfer_id,
        qr,
        receive_command: ReceiveCommand {
            code: code.clone(),
            posix: format!(
                "CROC_SECRET={code} croc{}",
                recv_flags(local, &custom_relay)
            ),
            interactive: "croc   # then paste the code when prompted".into(),
        },
        receive_link: croc::receive_link(&code, local),
        code,
    })
}

#[tauri::command]
pub fn croc_receive(
    app: AppHandle,
    code: String,
    out: Option<String>,
    relay: Option<String>,
    transfer_id: Option<String>,
    auto_accept: Option<bool>,
    local: Option<bool>,
) -> Result<CrocReceiveResult, String> {
    let trimmed = code.trim().to_string();
    if trimmed.is_empty() {
        return Err("Enter a transfer code.".into());
    }
    let transfer_id = transfer_id.unwrap_or_else(gen_id);
    let out = out
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_download_dir(&app));

    // Starts with any flags this platform always needs (Android: --internal-dns).
    let mut args: Vec<String> = croc::platform_global_flags();
    // Offline mode: `--local` → discover the sender via mDNS on the LAN, no public
    // relay. Ignores --relay (see croc_send). Both peers must be on the same network.
    if local.unwrap_or(false) {
        args.push("--local".into());
    } else if let Some(r) = relay.filter(|s| !s.is_empty()) {
        args.push("--relay".into());
        args.push(croc::resolve_relay(&r));
    }
    args.push("--out".into());
    args.push(out.clone());
    // Auto-accept (default): `--yes` auto-accepts the transfer, but we deliberately
    // omit `--overwrite` so croc offers to RESUME a partial file — the backend then
    // answers that prompt "yes" itself (auto_answer). Without auto-accept, leave all
    // prompts on so the app can surface accept + per-file overwrite/resume choices.
    let auto = auto_accept.unwrap_or(true);
    if auto {
        args.push("--yes".into());
    }

    croc::spawn_transfer(app.clone(), transfer_id.clone(), args, trimmed, None, auto)?;
    Ok(CrocReceiveResult { transfer_id, out })
}

/// Answer an interactive croc prompt (accept / overwrite / resume).
#[tauri::command]
pub fn croc_respond(app: AppHandle, transfer_id: String, yes: bool) {
    croc::respond(&app, &transfer_id, yes);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTest {
    pub address: String,
    pub reachable: bool,
    pub ms: u64,
    pub detail: String,
}

/// TCP-reachability check for the relay (custom, or croc's default). Confirms the
/// rendezvous server is reachable before blaming a stalled transfer on the code.
#[tauri::command]
pub async fn croc_relay_test(relay: Option<String>) -> RelayTest {
    use std::net::ToSocketAddrs;
    use std::time::{Duration, Instant};

    // croc's default public relay; a custom relay may omit the port.
    let raw = relay.filter(|s| !s.trim().is_empty());
    let address = match &raw {
        Some(r) if r.contains(':') => r.trim().to_string(),
        Some(r) => format!("{}:9009", r.trim()),
        None => "croc.schollz.com:9009".to_string(),
    };

    let addr = address.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        let socket_addrs = match addr.to_socket_addrs() {
            Ok(a) => a.collect::<Vec<_>>(),
            Err(e) => return (false, 0u64, format!("Can't resolve host: {e}")),
        };
        if socket_addrs.is_empty() {
            return (false, 0, "Host resolved to no addresses.".into());
        }
        for sa in &socket_addrs {
            if let Ok(stream) = std::net::TcpStream::connect_timeout(sa, Duration::from_secs(5)) {
                drop(stream);
                return (
                    true,
                    start.elapsed().as_millis() as u64,
                    "Relay is reachable.".into(),
                );
            }
        }
        (
            false,
            start.elapsed().as_millis() as u64,
            "Couldn't open a connection (timed out or refused).".into(),
        )
    })
    .await
    .unwrap_or((false, 0, "Test failed to run.".into()));

    RelayTest {
        address,
        reachable: result.0,
        ms: result.1,
        detail: result.2,
    }
}

#[tauri::command]
pub fn croc_cancel(app: AppHandle, transfer_id: String) {
    croc::cancel_transfer(&app, &transfer_id);
}

/// Android has no file manager to reveal into — received files are reached from
/// the app's own list, "Save to Downloads", or the share sheet.
#[cfg(mobile)]
#[tauri::command]
pub fn croc_show_item(_app: AppHandle, _path: String) {}

#[cfg(desktop)]
#[tauri::command]
pub fn croc_show_item(app: AppHandle, path: String) {
    if !path.is_empty() {
        let _ = app.opener().reveal_item_in_dir(path);
    }
}

/// Open a URL in the user's default browser (e.g. the project repository).
#[tauri::command]
pub fn croc_open_url(app: AppHandle, url: String) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

/// File paths on the OS clipboard (Finder/Explorer "Copy"), for in-app paste.
#[tauri::command]
pub fn croc_clipboard_files() -> Vec<String> {
    crate::clipboard::clipboard_file_paths()
}

/// Plain text on the OS clipboard, read natively (no paste-consent prompt).
#[tauri::command]
pub fn croc_clipboard_text() -> Option<String> {
    crate::clipboard::clipboard_text()
}

/// No Dock or taskbar to drive on Android — transfer progress belongs in the
/// foreground-service notification instead.
#[cfg(mobile)]
#[tauri::command]
pub fn croc_set_progress(_app: AppHandle, _progress: Option<u64>) {}

/// Drive the OS progress indicator (macOS Dock / Windows taskbar / Linux Unity).
/// `progress` is 0–100; `None` clears it. One cross-platform Tauri API.
#[cfg(desktop)]
#[tauri::command]
pub fn croc_set_progress(app: AppHandle, progress: Option<u64>) {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    if let Some(win) = app.get_webview_window("main") {
        let state = match progress {
            Some(p) => ProgressBarState {
                status: Some(ProgressBarStatus::Normal),
                progress: Some(p.min(100)),
            },
            None => ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            },
        };
        let _ = win.set_progress_bar(state);
    }
}

/// Write pasted bytes (base64) to a uniquely-named temp file and return its path,
/// so a pasted image or file can be handed to croc as a normal file to send.
#[tauri::command]
pub fn croc_save_temp_file(
    app: AppHandle,
    name: String,
    base64_data: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("Bad clipboard data: {e}"))?;
    // Keep the original filename (croc uses it) but isolate each paste in its own
    // subdir to avoid collisions.
    let clean = name.rsplit(['/', '\\']).next().unwrap_or("pasted-file");
    let clean = if clean.trim().is_empty() {
        "pasted-file"
    } else {
        clean.trim()
    };
    let dir = scratch_dir(&app, &format!("croc-paste-{}", gen_id()))?;
    let path = dir.join(clean);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn croc_history_list(app: AppHandle) -> Vec<HistoryEntry> {
    history::list(&app)
}

#[tauri::command]
pub fn croc_history_add(app: AppHandle, draft: HistoryDraft) -> Vec<HistoryEntry> {
    history::add(&app, draft)
}

#[tauri::command]
pub fn croc_history_remove(app: AppHandle, id: String) -> Vec<HistoryEntry> {
    history::remove(&app, &id)
}

#[tauri::command]
pub fn croc_history_clear(app: AppHandle) -> Vec<HistoryEntry> {
    history::clear(&app)
}

// ── nearby peers (LAN discovery, no listener) ─────────────────────────────
// Android stubs: mDNS there needs a WifiManager MulticastLock held for the whole
// time we browse or advertise, and without it multicast is silently dropped. Rather
// than ship something that looks like it works, the feature reports itself
// unavailable and the UI hides it. (mdns-sd is desktop-only in Cargo.toml.)
#[cfg(mobile)]
#[tauri::command]
pub fn croc_nearby_start() -> Result<(), String> {
    Err("Nearby devices aren't available on this platform yet.".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn croc_nearby_peers() -> Vec<serde_json::Value> {
    Vec::new()
}

#[cfg(mobile)]
#[tauri::command]
pub fn croc_nearby_discoverable(_code: Option<String>) -> Result<bool, String> {
    Err("Nearby devices aren't available on this platform yet.".into())
}

/// Start browsing for nearby croc devices. Browse-only: this does NOT advertise us,
/// so joining a network never broadcasts the device name by itself.
#[cfg(desktop)]
#[tauri::command]
pub fn croc_nearby_start(state: State<crate::nearby::NearbyState>) -> Result<(), String> {
    state.start_browsing()
}

/// Nearby devices currently accepting (self excluded). A peer with `code: null` is
/// visible but not accepting — nothing to send to.
#[cfg(desktop)]
#[tauri::command]
pub fn croc_nearby_peers(state: State<crate::nearby::NearbyState>) -> Vec<crate::nearby::Peer> {
    state.peers()
}

/// Become discoverable with a one-time `code`, or stop. While discoverable, anyone on
/// this network can see the code and send to it — which is why it's an explicit,
/// revocable choice rather than a default.
#[cfg(desktop)]
#[tauri::command]
pub fn croc_nearby_discoverable(
    state: State<crate::nearby::NearbyState>,
    code: Option<String>,
) -> Result<bool, String> {
    match code.filter(|c| c.trim().len() >= 6) {
        Some(code) => {
            state.set_discoverable(
                &hostname_or_default(),
                croc::EXPECTED_CROC_VERSION,
                code.trim(),
            )?;
            Ok(true)
        }
        None => {
            state.stop_discoverable()?;
            Ok(false)
        }
    }
}

/// A friendly device name for the advertisement — the machine's hostname.
#[cfg(desktop)]
fn hostname_or_default() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().trim_end_matches(".local").to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Croc Desktop".to_string())
}
