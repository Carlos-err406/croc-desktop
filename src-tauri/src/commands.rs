//! Tauri commands — the Rust port of electron/ipc/croc/main.ts.
use crate::croc::{self, CrocReceiveResult, CrocSendResult, ReceiveCommand, StatEntry};
use crate::history::{self, HistoryDraft, HistoryEntry};
use crate::codephrase;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

fn gen_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{now}-{}", rand::random::<u32>())
}

/// ~/Downloads/Croc (created if missing).
fn default_download_dir(app: &AppHandle) -> String {
    let base = app
        .path()
        .download_dir()
        .ok()
        .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join("Downloads")))
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("Croc");
    let _ = std::fs::create_dir_all(&dir);
    dir.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn croc_default_dir(app: AppHandle) -> String {
    default_download_dir(&app)
}

#[derive(serde::Serialize)]
pub struct CrocInfo {
    pub path: Option<String>,
    pub version: Option<String>,
    pub bundled: bool,
}

/// Which croc binary the app resolved, whether it's the bundled sidecar, and its version.
#[tauri::command]
pub fn croc_info() -> CrocInfo {
    let resolved = croc::find_croc_binary();
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
    CrocInfo {
        path: resolved.map(|p| p.to_string_lossy().into_owned()),
        version,
        bundled,
    }
}

#[tauri::command]
pub fn croc_stat_paths(paths: Vec<String>) -> Vec<StatEntry> {
    croc::stat_paths(paths)
}

// rfd can't pick files + folders in one dialog; this is a multi-file picker
// (folders are added via drag-drop). Async so the blocking dialog runs off the
// main thread.
#[tauri::command]
pub async fn croc_pick_paths(app: AppHandle) -> Vec<String> {
    app.dialog()
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
        .unwrap_or_default()
}

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

#[tauri::command]
pub fn croc_send(
    app: AppHandle,
    paths: Vec<String>,
    transfer_id: Option<String>,
    relay: Option<String>,
    zip: Option<bool>,
) -> Result<CrocSendResult, String> {
    if paths.is_empty() {
        return Err("No files selected.".into());
    }
    let transfer_id = transfer_id.unwrap_or_else(gen_id);
    let code = codephrase::generate_code();

    let mut args: Vec<String> = Vec::new();
    if let Some(r) = relay.filter(|s| !s.is_empty()) {
        args.push("--relay".into());
        args.push(r);
    }
    args.push("send".into());
    if zip.unwrap_or(false) {
        args.push("--zip".into());
    }
    args.extend(paths);

    croc::spawn_transfer(app.clone(), transfer_id.clone(), args, code.clone())?;

    let qr = croc::generate_qr_data_url(&code);
    Ok(CrocSendResult {
        transfer_id,
        qr,
        receive_command: ReceiveCommand {
            code: code.clone(),
            posix: format!("CROC_SECRET={code} croc"),
            interactive: "croc   # then paste the code when prompted".into(),
        },
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
) -> Result<CrocSendResult, String> {
    if text.is_empty() {
        return Err("Nothing to send.".into());
    }
    let transfer_id = transfer_id.unwrap_or_else(gen_id);
    let code = codephrase::generate_code();

    let mut args: Vec<String> = Vec::new();
    if let Some(r) = relay.filter(|s| !s.is_empty()) {
        args.push("--relay".into());
        args.push(r);
    }
    args.push("send".into());
    args.push("--text".into());
    args.push(text);

    croc::spawn_transfer(app.clone(), transfer_id.clone(), args, code.clone())?;

    let qr = croc::generate_qr_data_url(&code);
    Ok(CrocSendResult {
        transfer_id,
        qr,
        receive_command: ReceiveCommand {
            code: code.clone(),
            posix: format!("CROC_SECRET={code} croc"),
            interactive: "croc   # then paste the code when prompted".into(),
        },
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
) -> Result<CrocReceiveResult, String> {
    let trimmed = code.trim().to_string();
    if trimmed.is_empty() {
        return Err("Enter a transfer code.".into());
    }
    let transfer_id = transfer_id.unwrap_or_else(gen_id);
    let out = out
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_download_dir(&app));

    let mut args: Vec<String> = Vec::new();
    if let Some(r) = relay.filter(|s| !s.is_empty()) {
        args.push("--relay".into());
        args.push(r);
    }
    args.push("--out".into());
    args.push(out.clone());
    // Auto-accept (default) → suppress croc's prompts entirely. Otherwise leave
    // them on so the app can surface accept + per-file overwrite/resume prompts.
    if auto_accept.unwrap_or(true) {
        args.push("--yes".into());
        args.push("--overwrite".into());
    }

    croc::spawn_transfer(app.clone(), transfer_id.clone(), args, trimmed)?;
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
            if let Ok(stream) =
                std::net::TcpStream::connect_timeout(sa, Duration::from_secs(5))
            {
                drop(stream);
                return (true, start.elapsed().as_millis() as u64, "Relay is reachable.".into());
            }
        }
        (false, start.elapsed().as_millis() as u64, "Couldn't open a connection (timed out or refused).".into())
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

#[tauri::command]
pub fn croc_show_item(app: AppHandle, path: String) {
    if !path.is_empty() {
        let _ = app.opener().reveal_item_in_dir(path);
    }
}

/// File paths on the OS clipboard (Finder/Explorer "Copy"), for in-app paste.
#[tauri::command]
pub fn croc_clipboard_files() -> Vec<String> {
    crate::clipboard::clipboard_file_paths()
}

/// Write pasted bytes (base64) to a uniquely-named temp file and return its path,
/// so a pasted image or file can be handed to croc as a normal file to send.
#[tauri::command]
pub fn croc_save_temp_file(name: String, base64_data: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("Bad clipboard data: {e}"))?;
    // Keep the original filename (croc uses it) but isolate each paste in its own
    // subdir to avoid collisions.
    let clean = name.rsplit(['/', '\\']).next().unwrap_or("pasted-file");
    let clean = if clean.trim().is_empty() { "pasted-file" } else { clean.trim() };
    let dir = std::env::temp_dir().join("croc-desktop-paste").join(gen_id());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
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
