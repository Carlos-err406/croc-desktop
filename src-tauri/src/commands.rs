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

#[tauri::command]
pub fn croc_receive(
    app: AppHandle,
    code: String,
    out: Option<String>,
    relay: Option<String>,
    transfer_id: Option<String>,
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
    args.push("--yes".into());
    args.push("--overwrite".into());

    croc::spawn_transfer(app.clone(), transfer_id.clone(), args, trimmed)?;
    Ok(CrocReceiveResult { transfer_id, out })
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

#[tauri::command]
pub fn croc_history_list(app: AppHandle) -> Vec<HistoryEntry> {
    history::list(&app)
}

#[tauri::command]
pub fn croc_history_add(app: AppHandle, draft: HistoryDraft) -> Vec<HistoryEntry> {
    history::add(&app, draft)
}

#[tauri::command]
pub fn croc_history_clear(app: AppHandle) -> Vec<HistoryEntry> {
    history::clear(&app)
}
