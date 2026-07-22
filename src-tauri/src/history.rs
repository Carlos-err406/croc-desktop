//! Local transfer history: a single JSON file under the app data dir,
//! newest-first, capped at 200. Never leaves the device.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_ENTRIES: usize = 200;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub kind: String, // "send" | "receive"
    pub at: i64,      // epoch ms
    pub names: Vec<String>,
    pub count: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub size_human: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub out: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub is_text: Option<bool>,
}

/// The renderer supplies everything but `id` + `at` (added here).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDraft {
    pub kind: String,
    pub names: Vec<String>,
    pub count: u32,
    #[serde(default)]
    pub size_human: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub out: Option<String>,
    #[serde(default)]
    pub is_text: Option<bool>,
}

fn history_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("history.json"))
}

pub fn list(app: &AppHandle) -> Vec<HistoryEntry> {
    let Ok(path) = history_file(app) else {
        return vec![];
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => vec![], // missing/corrupt → empty
    }
}

pub fn add(app: &AppHandle, draft: HistoryDraft) -> Vec<HistoryEntry> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let id = format!("{}-{}", now, rand::random::<u32>());
    let entry = HistoryEntry {
        id,
        kind: draft.kind,
        at: now,
        names: draft.names,
        count: draft.count,
        size_human: draft.size_human,
        code: draft.code,
        out: draft.out,
        is_text: draft.is_text,
    };
    let mut next = list(app);
    next.insert(0, entry);
    next.truncate(MAX_ENTRIES);
    if let Ok(path) = history_file(app) {
        let _ = std::fs::write(&path, serde_json::to_string(&next).unwrap_or_else(|_| "[]".into()));
    }
    next
}

pub fn clear(app: &AppHandle) -> Vec<HistoryEntry> {
    if let Ok(path) = history_file(app) {
        let _ = std::fs::write(&path, "[]");
    }
    vec![]
}
