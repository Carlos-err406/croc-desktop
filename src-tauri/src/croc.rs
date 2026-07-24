//! The croc engine: spawn `croc` in a PTY (portable-pty), parse its TTY-gated
//! output into typed events streamed to the webview, and support cancel. This is
//! the Rust port of the Electron `electron/lib/croc.ts` CrocProcess.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// A live transfer: `killer` lets `croc_cancel` stop it; `writer` lets
/// `croc_respond` answer croc's interactive prompts (accept / overwrite) by
/// writing to the PTY (e.g. "y\n").
pub struct Transfer {
    pub killer: Box<dyn ChildKiller + Send + Sync>,
    pub writer: Box<dyn Write + Send>,
}

/// Active transfers keyed by transferId.
#[derive(Default)]
pub struct CrocState {
    pub transfers: Mutex<HashMap<String, Transfer>>,
}

// ── DTOs (camelCase to match the frontend contract) ───────────────────────
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub size_human: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub is_dir: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveCommand {
    pub code: String,
    pub posix: String,
    pub interactive: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrocSendResult {
    pub transfer_id: String,
    pub code: String,
    pub qr: Option<String>,
    pub receive_command: ReceiveCommand,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrocReceiveResult {
    pub transfer_id: String,
    pub out: String,
}

// ── binary resolution + humanization ──────────────────────────────────────
fn croc_exe() -> &'static str {
    if cfg!(windows) {
        "croc.exe"
    } else {
        "croc"
    }
}

/// The croc binary bundled next to the app executable (Tauri externalBin sidecar).
pub fn bundled_croc_binary() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidate = dir.join(croc_exe());
    candidate.exists().then_some(candidate)
}

pub fn find_croc_binary() -> Option<PathBuf> {
    // Explicit override wins (power users / tests).
    if let Ok(p) = std::env::var("CROC_BIN") {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return Some(pb);
        }
    }
    // Prefer the bundled sidecar so the app is self-contained.
    if let Some(pb) = bundled_croc_binary() {
        return Some(pb);
    }
    // Fall back to PATH (e.g. during `tauri dev`, or if the sidecar is missing).
    let mut dirs: Vec<PathBuf> = std::env::var("PATH")
        .unwrap_or_default()
        .split(if cfg!(windows) { ';' } else { ':' })
        .map(PathBuf::from)
        .collect();
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(extra));
    }
    for dir in dirs {
        let candidate = dir.join(croc_exe());
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub fn human_bytes(n: u64) -> String {
    if n < 1000 {
        return format!("{n} B");
    }
    let units = ["kB", "MB", "GB", "TB"];
    let mut v = n as f64 / 1000.0;
    let mut i = 0;
    while v >= 1000.0 && i < units.len() - 1 {
        v /= 1000.0;
        i += 1;
    }
    if v < 10.0 {
        format!("{:.1} {}", v, units[i])
    } else {
        format!("{} {}", v.round() as u64, units[i])
    }
}

fn badge_type(name: &str, is_dir: bool) -> String {
    if is_dir {
        return "DIR".into();
    }
    match name.rsplit_once('.') {
        Some((_, ext)) if !ext.is_empty() => ext.to_uppercase().chars().take(4).collect(),
        _ => "FILE".into(),
    }
}

pub fn stat_paths(paths: Vec<String>) -> Vec<StatEntry> {
    paths
        .into_iter()
        .map(|p| {
            let name = std::path::Path::new(&p)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone());
            match std::fs::metadata(&p) {
                Ok(md) => {
                    let is_dir = md.is_dir();
                    StatEntry {
                        size: if is_dir { 0 } else { md.len() },
                        size_human: if is_dir {
                            "Folder".into()
                        } else {
                            human_bytes(md.len())
                        },
                        kind: badge_type(&name, is_dir),
                        is_dir,
                        name,
                        path: p,
                    }
                }
                Err(_) => StatEntry {
                    path: p,
                    name,
                    size: 0,
                    size_human: String::new(),
                    kind: "FILE".into(),
                    is_dir: false,
                },
            }
        })
        .collect()
}

pub fn generate_qr_data_url(code: &str) -> Option<String> {
    use qrcode::{render::svg, QrCode};
    let qr = QrCode::new(code.as_bytes()).ok()?;
    let svg = qr
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .dark_color(svg::Color("#0b1220"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Some(format!(
        "data:image/svg+xml;base64,{}",
        STANDARD.encode(svg.as_bytes())
    ))
}

// ── output parsing (ports the regexes from croc.ts) ───────────────────────
static ANSI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])").unwrap());
static TEXT_INFO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:Sending|Receiving)\s+text message\s*\(([^)]+)\)").unwrap());
static PEER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:Sending|Receiving)\s*\((?:->|<-)").unwrap());
static ARROW: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\((?:->|<-)").unwrap());
static INFO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:Sending|Receiving)\s+(?:(\d+)\s+files?|'?(.+?)'?)\s+\(([\d.]+\s*[kKmMgGtT]?i?[bB])\)")
        .unwrap()
});
static STATS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\(\s*([\d.]+(?:\s*[kKmMgGtT]?i?[bB])?)\s*/\s*([\d.]+\s*[kKmMgGtT]?i?[bB])(?:,\s*([\d.]+\s*[kKmMgGtT]?i?[bB]/s))?")
        .unwrap()
});
static PCT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\d{1,3})%").unwrap());
static ETA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([\dhms:]+)\s*:\s*([\dhms:]+)\]").unwrap());
static FILE_M: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?)\s+\d{1,3}%").unwrap());
static NM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\d+)\s*/\s*(\d+)\s*$").unwrap());
static TRAIL_DOTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*(?:\.{3,}|…)\s*$").unwrap());
static WAITING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(code is|on the other computer|sending|connecting|securing channel)").unwrap()
});
// Interactive prompts (croc writes them to the TTY with NO trailing newline, so
// they live in the partial tail and are detected there rather than per-line).
static ACCEPT_PROMPT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)Accept\s+(.+?)\s+\(([^)]+)\)(?:\s+from\s+'[^']*')?\?\s*\(Y/n\)").unwrap()
});
static RESUME_PROMPT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)Resume\s+'(.+?)'\s+\(([\d.]+)%\)\?\s*\(y/N\)").unwrap()
});
static OVERWRITE_PROMPT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Overwrite\s+'(.+?)'\?\s*\(y/N\)").unwrap());
// The (Y/n)/(y/N) marker signals a prompt. Matched anywhere (not end-anchored),
// because overwrite/resume prompts trail "(use --overwrite to omit)" after it.
static ANY_PROMPT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\((?:Y/n|y/N)\)").unwrap());
// Lines that carry a real failure reason worth surfacing, so a non-zero exit can
// show croc's actual message instead of just "exited with code N".
static ERROR_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(error|failed|cannot|could not|no such|not found|refus\w+|too short|incorrect|mismatch|unreachable|timed out|connection refused|password|permission denied)\b",
    )
    .unwrap()
});

const MAX_LOG_EMITS: u32 = 1000;
const MAX_TOTAL_LINES: u64 = 100_000;

struct Parser {
    app: AppHandle,
    transfer_id: String,
    saw_progress: bool,
    finished: bool,
    line_buf: String,
    log_count: u32,
    total_lines: u64,
    text_mode: bool,
    text_started: bool,
    text_lines: Vec<String>,
    last_prompt: Option<String>,
    last_error: Option<String>,
}

impl Parser {
    fn new(app: AppHandle, transfer_id: String) -> Self {
        Self {
            app,
            transfer_id,
            saw_progress: false,
            finished: false,
            line_buf: String::new(),
            log_count: 0,
            total_lines: 0,
            text_mode: false,
            text_started: false,
            text_lines: Vec::new(),
            last_prompt: None,
            last_error: None,
        }
    }

    fn emit(&self, event: serde_json::Value) {
        let _ = self.app.emit("croc://event", event);
    }

    fn send(&self, ty: &str, mut extra: serde_json::Map<String, serde_json::Value>) {
        extra.insert("transferId".into(), self.transfer_id.clone().into());
        extra.insert("type".into(), ty.into());
        self.emit(serde_json::Value::Object(extra));
    }

    fn ingest(&mut self, data: &str) {
        if self.finished {
            return;
        }
        self.line_buf.push_str(data);
        // Split on \r\n | \r | \n, keeping the trailing partial line buffered.
        let normalized = self.line_buf.replace("\r\n", "\n").replace('\r', "\n");
        let mut parts: Vec<&str> = normalized.split('\n').collect();
        let tail = parts.pop().unwrap_or("").to_string();
        let lines: Vec<String> = parts.iter().map(|s| s.to_string()).collect();
        self.line_buf = tail;
        for raw in lines {
            self.handle_line(&raw);
        }
        // An interactive prompt has no trailing newline, so it stays in the tail.
        let tail = self.line_buf.clone();
        self.detect_prompt(&tail);
    }

    /// If the pending (newline-less) tail is a croc prompt, surface it once so the
    /// UI can answer it via `croc_respond`.
    fn detect_prompt(&mut self, tail: &str) {
        if self.finished {
            return;
        }
        let clean = ANSI.replace_all(tail, "").trim().to_string();
        if clean.is_empty() || !ANY_PROMPT.is_match(&clean) {
            return;
        }
        if self.last_prompt.as_deref() == Some(clean.as_str()) {
            return; // already surfaced this exact prompt
        }
        self.last_prompt = Some(clean.clone());

        let mut m = serde_json::Map::new();
        if let Some(c) = ACCEPT_PROMPT.captures(&clean) {
            m.insert("kind".into(), "accept".into());
            m.insert("fname".into(), c[1].trim_matches('\'').to_string().into());
            m.insert("size".into(), c[2].to_string().into());
            m.insert("defaultYes".into(), true.into());
        } else if let Some(c) = RESUME_PROMPT.captures(&clean) {
            m.insert("kind".into(), "resume".into());
            m.insert("file".into(), c[1].to_string().into());
            m.insert("percent".into(), c[2].parse::<f64>().unwrap_or(0.0).into());
            m.insert("defaultYes".into(), false.into());
        } else if let Some(c) = OVERWRITE_PROMPT.captures(&clean) {
            m.insert("kind".into(), "overwrite".into());
            m.insert("file".into(), c[1].to_string().into());
            m.insert("defaultYes".into(), false.into());
        } else {
            m.insert("kind".into(), "confirm".into());
            m.insert("message".into(), clean.clone().into());
            m.insert("defaultYes".into(), clean.contains("(Y/n)").into());
        }
        self.send("prompt", m);
    }

    fn handle_line(&mut self, raw: &str) {
        if self.finished {
            return;
        }
        self.total_lines += 1;
        if self.total_lines > MAX_TOTAL_LINES {
            self.finished = true;
            self.send(
                "error",
                serde_json::Map::from_iter([(
                    "message".into(),
                    "Aborted: unexpected runaway output from croc.".into(),
                )]),
            );
            return;
        }

        let line = ANSI.replace_all(raw, "").trim().to_string();
        if line.is_empty() {
            return;
        }

        if self.log_count < MAX_LOG_EMITS {
            self.log_count += 1;
            self.send(
                "log",
                serde_json::Map::from_iter([("line".into(), line.clone().into())]),
            );
        }

        // Remember the most recent failure-looking line (ignoring benign croc
        // hints), so a non-zero exit can report croc's real reason.
        if ERROR_LINE.is_match(&line) && !line.contains("use --overwrite") {
            self.last_error = Some(line.clone());
        }

        // Text transfer body: everything after the peer line is the message.
        if self.text_mode && self.text_started {
            self.text_lines.push(line);
            return;
        }
        if let Some(c) = TEXT_INFO.captures(&line) {
            self.text_mode = true;
            self.send(
                "file-info",
                serde_json::Map::from_iter([(
                    "info".into(),
                    serde_json::json!({
                        "name": "Text message",
                        "totalHuman": c[1].trim(),
                        "isText": true,
                    }),
                )]),
            );
            return;
        }

        // Peer connected: "Sending (->ip)" / "Receiving (<-ip)".
        if PEER.is_match(&line) {
            self.send("peer", serde_json::Map::new());
            if self.text_mode {
                self.text_started = true;
                return;
            }
        }

        // What's being transferred: "Sending 'f' (293 kB)" / "Receiving 3 files (1.2 MB)".
        if let Some(c) = INFO.captures(&line) {
            let count = c.get(1).map(|m| m.as_str());
            if !ARROW.is_match(&line) && count != Some("0") {
                let name = match count {
                    Some(n) => format!("{n} files"),
                    None => c.get(2).map(|m| m.as_str()).unwrap_or("").to_string(),
                };
                let mut info = serde_json::Map::new();
                info.insert("name".into(), name.into());
                info.insert("totalHuman".into(), c[3].to_string().into());
                if let Some(n) = count.and_then(|s| s.parse::<u32>().ok()) {
                    info.insert("count".into(), n.into());
                }
                self.send(
                    "file-info",
                    serde_json::Map::from_iter([(
                        "info".into(),
                        serde_json::Value::Object(info),
                    )]),
                );
            }
        }

        // A genuine progress line MUST carry "(x/y unit[, speed])".
        if let Some(s) = STATS.captures(&line) {
            let percent = PCT
                .captures(&line)
                .and_then(|c| c[1].parse::<u32>().ok())
                .map(|p| p.min(100))
                .unwrap_or(0);
            let eta = ETA.captures(&line).map(|c| c[2].to_string());
            let file = FILE_M.captures(&line).and_then(|c| {
                let cleaned = TRAIL_DOTS.replace(c[1].trim(), "").trim_end().to_string();
                if cleaned.is_empty() {
                    None
                } else {
                    Some(cleaned)
                }
            });
            let nm = NM.captures(&line);
            self.saw_progress = true;
            let progress = serde_json::json!({
                "percent": percent,
                "transferredHuman": s[1].to_string(),
                "totalHuman": s[2].to_string(),
                "speedHuman": s.get(3).map(|m| m.as_str()),
                "etaHuman": eta,
                "file": file,
                "index": nm.as_ref().and_then(|c| c[1].parse::<u32>().ok()),
                "count": nm.as_ref().and_then(|c| c[2].parse::<u32>().ok()),
            });
            self.send(
                "progress",
                serde_json::Map::from_iter([("progress".into(), progress)]),
            );
            return;
        }

        if !self.saw_progress && WAITING.is_match(&line) {
            self.send("waiting", serde_json::Map::new());
        }
    }

    fn finalize(&mut self, exit_code: i32) {
        if !self.line_buf.is_empty() {
            let buf = std::mem::take(&mut self.line_buf);
            self.handle_line(&buf);
        }
        if self.text_mode && !self.finished {
            let body = self.text_lines.join("\n").trim().to_string();
            self.send(
                "text",
                serde_json::Map::from_iter([("text".into(), body.into())]),
            );
        }
        if !self.finished {
            self.finished = true;
            if exit_code == 0 {
                self.send("done", serde_json::Map::new());
            } else {
                self.send(
                    "error",
                    serde_json::Map::from_iter([(
                        "message".into(),
                        humanize_error(self.last_error.as_deref(), exit_code).into(),
                    )]),
                );
            }
        }
        self.send(
            "exit",
            serde_json::Map::from_iter([("code".into(), exit_code.into())]),
        );
    }
}

/// Turn croc's raw failure line (or a bare exit code) into a friendly message.
fn humanize_error(raw: Option<&str>, exit_code: i32) -> String {
    let line = raw.unwrap_or("").trim();
    let low = line.to_lowercase();
    if low.contains("too short") {
        return "That code is too short — it must be at least 6 characters.".into();
    }
    if low.contains("refus") {
        return "The other side declined the transfer.".into();
    }
    if low.contains("incorrect") || low.contains("mismatch") || low.contains("password") {
        return "Couldn't connect: the code didn't match. Double-check it and try again.".into();
    }
    if low.contains("no such") || low.contains("not found") || low.contains("permission denied") {
        return format!("File error: {line}");
    }
    if low.contains("unreachable")
        || low.contains("timed out")
        || low.contains("connection refused")
        || low.contains("dial")
    {
        return "Couldn't reach the relay. Check your connection, or try a different relay in Settings.".into();
    }
    if !line.is_empty() {
        // Surface croc's own words, trimmed of any leading log prefix.
        let msg = line.rsplit(']').next().unwrap_or(line).trim();
        return format!("croc: {msg}");
    }
    format!("Transfer failed (croc exited with code {exit_code}).")
}

/// Spawn croc with the given args + CROC_SECRET, stream events, register the
/// killer for cancel. Returns once the process is launched (it keeps running in
/// a background thread).
pub fn spawn_transfer(
    app: AppHandle,
    transfer_id: String,
    args: Vec<String>,
    secret: String,
) -> Result<(), String> {
    let bin = find_croc_binary()
        .ok_or("croc binary not found. Install croc (e.g. `brew install croc`) or set CROC_BIN.")?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 1000, // wide PTY so croc prints full filenames (not truncated + "...")
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(bin);
    for a in &args {
        cmd.arg(a);
    }
    cmd.env("CROC_SECRET", &secret);
    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env("PATH", format!("{path}:/opt/homebrew/bin:/usr/local/bin"));
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    {
        let state = app.state::<CrocState>();
        state
            .transfers
            .lock()
            .unwrap()
            .insert(transfer_id.clone(), Transfer { killer, writer });
    }

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    std::thread::spawn(move || {
        // Keep the master alive for the duration of the read loop.
        let _master = pair.master;
        let mut parser = Parser::new(app.clone(), transfer_id.clone());
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => parser.ingest(&String::from_utf8_lossy(&buf[..n])),
                Err(_) => break,
            }
        }
        let exit_code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
        parser.finalize(exit_code);
        let state = app.state::<CrocState>();
        state.transfers.lock().unwrap().remove(&transfer_id);
    });

    Ok(())
}

pub fn cancel_transfer(app: &AppHandle, transfer_id: &str) {
    let state = app.state::<CrocState>();
    let mut map = state.transfers.lock().unwrap();
    if let Some(t) = map.get_mut(transfer_id) {
        let _ = t.killer.kill();
    }
}

/// Answer an interactive croc prompt (accept / overwrite / resume) by writing to
/// its PTY. `yes` → "y\n", otherwise "n\n".
pub fn respond(app: &AppHandle, transfer_id: &str, yes: bool) {
    let state = app.state::<CrocState>();
    let mut map = state.transfers.lock().unwrap();
    if let Some(t) = map.get_mut(transfer_id) {
        let _ = t.writer.write_all(if yes { b"y\n" } else { b"n\n" });
        let _ = t.writer.flush();
    }
}
