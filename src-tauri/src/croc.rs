//! The croc engine: spawn `croc`, parse its output into typed events streamed to
//! the webview, and support cancel/respond. Originally a Rust port of the Electron
//! `electron/lib/croc.ts` CrocProcess.
//!
//! Two transports feed ONE parser (see the `transport` module):
//!   * desktop — a real pty (portable-pty), which is what the Electron app used.
//!   * Android — plain pipes with stderr merged into stdout and COLUMNS set wide.
//!     Tauri's sidecar mechanism is desktop-only and portable-pty isn't built for
//!     Android at all, so pipes are the only option there. They're sufficient
//!     because croc writes its progress bar to stderr (gated on text mode, not on
//!     a tty) and reads prompts from a plain stdin.
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// A live transfer: `killer` stops it for `croc_cancel`; `writer` answers croc's
/// interactive prompts (accept / overwrite / resume) for `croc_respond` by writing
/// "y\n" to the pty master or the child's stdin, depending on transport.
pub struct Transfer {
    pub killer: transport::Killer,
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
    pub exists: bool,
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
    pub receive_link: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrocReceiveResult {
    pub transfer_id: String,
    pub out: String,
}

// ── binary resolution + humanization ──────────────────────────────────────
/// The croc version we bundle as the sidecar. MUST match `CROC_VERSION` in
/// scripts/fetch-croc.mjs, and should track the version the companion Android app
/// vendors (croc-app v5.1.0 → 10.6.0) since croc is protocol-sensitive across
/// minor lines (10.4 ↔ 10.6 don't interoperate reliably). Surfaced to the UI so it
/// can warn when the app is running a *different* croc (a system one on PATH).
/// Compared as a substring against `croc --version`, ignoring the leading "v"
/// (croc prints it inconsistently between releases).
pub const EXPECTED_CROC_VERSION: &str = "v10.6.0";

#[cfg(not(target_os = "android"))]
fn croc_exe() -> &'static str {
    if cfg!(windows) {
        "croc.exe"
    } else {
        "croc"
    }
}

/// The croc binary bundled next to the app executable (Tauri externalBin sidecar).
/// Tauri places it next to the main binary (/usr/bin on Linux .deb, usr/bin inside
/// the AppImage mount, Contents/MacOS in the .app, alongside the .exe on Windows).
/// We check the exe dir AND its symlink-resolved form (some Linux launchers exec
/// through a symlink, which would otherwise make `parent()` point where the sidecar
/// isn't) so we don't silently fall through to a possibly-incompatible system croc.
#[cfg(not(target_os = "android"))]
pub fn bundled_croc_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(d) = exe.parent() {
        dirs.push(d.to_path_buf());
    }
    if let Ok(real) = std::fs::canonicalize(&exe) {
        if let Some(d) = real.parent().map(|p| p.to_path_buf()) {
            if !dirs.contains(&d) {
                dirs.push(d);
            }
        }
    }
    let name = croc_exe();
    dirs.into_iter().map(|d| d.join(name)).find(|c| c.exists())
}

pub fn find_croc_binary() -> Option<PathBuf> {
    // Explicit override wins (power users / tests). On Android this is the ONLY
    // path: MainActivity sets CROC_BIN to nativeLibraryDir/libcroc.so before Rust
    // starts, because that directory is the one place an app may execute from
    // (app-writable storage is mounted no-exec) and Rust can't read
    // ApplicationInfo without JNI.
    if let Ok(p) = std::env::var("CROC_BIN") {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return Some(pb);
        }
    }
    // Inside an Android sandbox there is no sidecar and no PATH to fall back to, so
    // a missing CROC_BIN means the MainActivity hook didn't run — a build problem,
    // not something to paper over by executing an unexpected binary.
    #[cfg(target_os = "android")]
    {
        None
    }
    #[cfg(not(target_os = "android"))]
    {
        find_croc_binary_desktop()
    }
}

/// Sidecar-then-PATH lookup, split out so the Android branch above has no
/// unreachable code behind it.
#[cfg(not(target_os = "android"))]
fn find_croc_binary_desktop() -> Option<PathBuf> {
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

// ── Android DNS ───────────────────────────────────────────────────────────
// Android ships no /etc/resolv.conf. croc is pure Go with CGO disabled, so its
// resolver reads that file, finds nothing, falls back to 127.0.0.1:53 and fails
// every lookup — including the one croc does on its own DEFAULT_RELAY at startup.
// Two complementary fixes, because neither covers the other's case:

/// Global flags that must precede any subcommand on this platform.
///
/// `--internal-dns` makes croc use its built-in list of public resolvers (Quad9,
/// OpenDNS, Comodo…) instead of the host's. croc picks it up in `init()` by
/// scanning argv, so position only matters to croc's own flag parser.
///
/// `--ignore-stdin` is what makes the pipe transport able to send anything at all.
/// croc decides between "send the named files" and "send piped stdin" with
/// `(stat.Mode() & os.ModeCharDevice) == 0 && !ignore-stdin` (croc cli.go). A pty
/// sets ModeCharDevice, so desktop never hits it — but the Android transport gives
/// croc a real pipe on stdin (needed to answer prompts), so without this flag croc
/// ignores the file arguments and sends stdin instead. Observed on a device before
/// this flag existed: the peer received a 1-byte file called `croc-stdin-1215114507`.
/// The `--text` branch sits behind the same `else if`, so text sends were broken the
/// same way. IgnoreStdin is read at that one site only and does NOT affect prompt
/// reading, so review mode still works.
pub fn platform_global_flags() -> Vec<String> {
    #[cfg(mobile)]
    {
        vec!["--internal-dns".to_string(), "--ignore-stdin".to_string()]
    }
    #[cfg(desktop)]
    {
        Vec::new()
    }
}

/// Resolve a relay's hostname to an IP with the PLATFORM resolver, yielding
/// `ip:port`.
///
/// This is not redundant with `--internal-dns`: croc's stub resolver only knows
/// public DNS, so a relay on the local network (or any private name) resolves
/// here and nowhere else. Identity on desktop — the host resolver already works
/// there, and passing croc an IP instead of the name the user typed would be a
/// behaviour change for no gain. IP literals and port-less values pass through.
pub fn resolve_relay(relay: &str) -> String {
    #[cfg(desktop)]
    {
        relay.to_string()
    }
    #[cfg(mobile)]
    {
        use std::net::{IpAddr, ToSocketAddrs};

        let trimmed = relay.trim();
        // Only "host:port" can be rewritten; without a port croc applies its own
        // default and we'd be guessing.
        let Some((host, port)) = trimmed.rsplit_once(':') else {
            return trimmed.to_string();
        };
        if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
            return trimmed.to_string();
        }
        let host = host.trim_start_matches('[').trim_end_matches(']');
        if host.parse::<IpAddr>().is_ok() {
            return trimmed.to_string(); // already literal
        }
        let Ok(addrs) = (host, port.parse::<u16>().unwrap_or(0)).to_socket_addrs() else {
            return trimmed.to_string();
        };
        // Prefer IPv4: croc's relay listens on both, and a phone on a v4-only
        // network that picked the AAAA record would just time out.
        let mut found: Vec<_> = addrs.collect();
        found.sort_by_key(|a| u8::from(a.is_ipv6()));
        match found.first().map(|a| a.ip()) {
            Some(IpAddr::V4(ip)) => format!("{ip}:{port}"),
            Some(IpAddr::V6(ip)) => format!("[{ip}]:{port}"),
            None => trimmed.to_string(),
        }
    }
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
                        exists: true,
                    }
                }
                Err(_) => StatEntry {
                    path: p,
                    name,
                    size: 0,
                    size_human: String::new(),
                    kind: "FILE".into(),
                    is_dir: false,
                    exists: false,
                },
            }
        })
        .collect()
}

/// Percent-encode a code for safe use in a URL query value.
fn pct(code: &str) -> String {
    let mut s = String::new();
    for b in code.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                s.push(b as char)
            }
            _ => s.push_str(&format!("%{b:02X}")),
        }
    }
    s
}

// The shareable https App Link ("Copy link") is built on the frontend
// (SendScreen), so there's no backend helper for it — only the QR's deep link.

/// The `croc://` deep link for a code. The QR encodes THIS (not the https link):
/// scanning it with a phone camera / QR app opens the installed app directly via
/// the custom scheme, whereas a scanned https App Link doesn't reliably hand off.
/// Every scanner (Android app, Croc Desktop) still parses the code out of it.
/// `local` embeds the sender's local-only setting so the receiver auto-applies it
/// for that transfer (scan the QR / click the link → receive over the LAN, no
/// manual toggle). Extensible: more connection settings (relay, ip) can be added
/// as further `&key=value` params, which the parser already tolerates.
pub fn receive_deeplink(code: &str, local: bool) -> String {
    let mut s = format!("croc://receive?code={}", pct(code));
    if local {
        s.push_str("&local=1");
    }
    s.push_str(&croc_version_param());
    s
}

/// The shareable https App Link ("Copy link") for a code. Mirrors the deep link
/// above, embedding the sender's local-only setting so the receiver auto-applies
/// it, and keeping the link consistent with what the QR already encodes.
pub fn receive_link(code: &str, local: bool) -> String {
    let mut s = format!(
        "https://carlos-err406.github.io/croc/receive?code={}",
        pct(code)
    );
    if local {
        s.push_str("&local=1");
    }
    s.push_str(&croc_version_param());
    s
}

/// `&v=<croc version>` — the croc version this sender transfers with. The receiver
/// compares its major.minor against its own bundled croc and warns on a mismatch
/// (croc doesn't interoperate across minor lines), turning an otherwise cryptic
/// handshake failure into "update first". Readers that don't know `v` ignore it.
fn croc_version_param() -> String {
    format!("&v={}", pct(EXPECTED_CROC_VERSION.trim_start_matches('v')))
}

// ── reverse pairing: "send to me" ─────────────────────────────────────────
// The mirror of the links above. A RECEIVER publishes one of these ("scan to send
// me a file"); the scanner sees action=send and opens its Send screen pre-filled
// with the code, instead of trying to receive. Same `&v=` version hint applies.

/// `croc://send?code=…` — deep link asking the opener to SEND to this code.
pub fn send_deeplink(code: &str) -> String {
    format!("croc://send?code={}{}", pct(code), croc_version_param())
}

/// The https twin of [`send_deeplink`], for sharing the request in chat. The Pages
/// `/croc/send` route hands off to the `croc://send` deep link.
pub fn send_link(code: &str) -> String {
    format!(
        "https://carlos-err406.github.io/croc/send?code={}{}",
        pct(code),
        croc_version_param()
    )
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
static TEXT_INFO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:Sending|Receiving)\s+text message\s*\(([^)]+)\)").unwrap()
});
static PEER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:Sending|Receiving)\s*\((?:->|<-)").unwrap());
static ARROW: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\((?:->|<-)").unwrap());
static INFO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:Sending|Receiving)\s+(?:(\d+)\s+files?|'?(.+?)'?)\s+\(([\d.]+\s*[kKmMgGtT]?i?[bB])\)",
    )
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
static RESUME_PROMPT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Resume\s+'(.+?)'\s+\(([\d.]+)%\)\?\s*\(y/N\)").unwrap());
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
    // Auto-accept mode: answer croc's overwrite/resume prompts "yes" ourselves
    // (silently) instead of surfacing them, so partial downloads resume without
    // user input. Enabled for receive when auto-accept is on.
    auto_answer_prompts: bool,
}

impl Parser {
    fn new(app: AppHandle, transfer_id: String, auto_answer_prompts: bool) -> Self {
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
            auto_answer_prompts,
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

        // Auto-accept mode: say "yes" to overwrite/resume prompts ourselves so a
        // partial download resumes (croc transfers only the missing chunks) without
        // bothering the user — replacing the blunt `--overwrite` that re-downloaded
        // from scratch. (The initial accept prompt is handled by croc's own --yes.)
        if self.auto_answer_prompts {
            respond(&self.app, &self.transfer_id, true);
            return;
        }

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
                    serde_json::Map::from_iter([("info".into(), serde_json::Value::Object(info))]),
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

/// Spawning croc. Desktop uses a pty; Android uses pipes. Both hand back the same
/// four handles, so `spawn_transfer` and the parser never learn which is in play.
pub mod transport {
    use std::io::{Read, Write};
    use std::path::PathBuf;

    /// Everything `spawn_transfer` needs from a freshly-spawned croc.
    pub struct Spawned {
        /// croc's stdout AND stderr, interleaved. The progress bar goes to stderr,
        /// so a transport that drops stderr shows no progress at all.
        pub reader: Box<dyn Read + Send>,
        /// Answers croc's prompts ("y\n").
        pub writer: Box<dyn Write + Send>,
        pub killer: Killer,
        /// Blocks until croc exits, yielding its exit code. Owns anything that has
        /// to outlive the read loop (on desktop, the pty master).
        pub wait: Box<dyn FnOnce() -> i32 + Send>,
    }

    #[cfg(desktop)]
    pub type Killer = Box<dyn portable_pty::ChildKiller + Send + Sync>;
    #[cfg(mobile)]
    pub type Killer = PipeKiller;

    /// A 30×1000 pty. The absurd width is deliberate: croc sizes its progress bar
    /// to the terminal and truncates long filenames to fit, so a narrow terminal
    /// would cost us the filenames the UI displays.
    #[cfg(desktop)]
    pub fn spawn(
        bin: PathBuf,
        args: &[String],
        env: &[(String, String)],
        cwd: Option<&PathBuf>,
    ) -> Result<Spawned, String> {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 30,
                cols: 1000,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(bin);
        for a in args {
            cmd.arg(a);
        }
        for (k, v) in env {
            cmd.env(k, v);
        }
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let killer = child.clone_killer();
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let master = pair.master;

        Ok(Spawned {
            reader,
            writer,
            killer,
            wait: Box::new(move || {
                // Hold the master until croc is gone; dropping it early closes the
                // pty out from under the child.
                let _master = master;
                child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1)
            }),
        })
    }

    /// Plain pipes, with stdout and stderr pointed at the SAME pipe. Two separate
    /// pipes read by two threads would interleave nondeterministically, and the
    /// parser's "an unfinished prompt is the newline-less tail" rule depends on
    /// arrival order — so the fds are dup'd onto one writer instead.
    #[cfg(mobile)]
    pub fn spawn(
        bin: PathBuf,
        args: &[String],
        env: &[(String, String)],
        cwd: Option<&PathBuf>,
    ) -> Result<Spawned, String> {
        use std::process::{Command, Stdio};
        use std::sync::{Arc, Mutex};

        let (read_end, write_end) = os_pipe::pipe().map_err(|e| e.to_string())?;
        let write_dup = write_end.try_clone().map_err(|e| e.to_string())?;

        let mut cmd = Command::new(bin);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::from(write_end))
            .stderr(Stdio::from(write_dup));
        for (k, v) in env {
            cmd.env(k, v);
        }
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        // Both write ends move into the Command, so the parent's copies are closed
        // by spawn(); otherwise the reader below would never see EOF.
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let writer = child.stdin.take().ok_or("croc stdin unavailable")?;
        let shared = Arc::new(Mutex::new(child));
        let killer = PipeKiller(Arc::clone(&shared));

        Ok(Spawned {
            reader: Box::new(read_end),
            writer: Box::new(writer),
            killer,
            wait: Box::new(move || loop {
                // try_wait + sleep, never a blocking wait: holding this mutex
                // across wait() would deadlock a concurrent cancel().
                match shared.lock().unwrap().try_wait() {
                    Ok(Some(status)) => break status.code().unwrap_or(-1),
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                    Err(_) => break -1,
                }
            }),
        })
    }

    /// Cancel handle for the pipe transport, mirroring portable-pty's ChildKiller.
    #[cfg(mobile)]
    pub struct PipeKiller(pub std::sync::Arc<std::sync::Mutex<std::process::Child>>);

    #[cfg(mobile)]
    impl PipeKiller {
        pub fn kill(&mut self) -> std::io::Result<()> {
            self.0.lock().unwrap().kill()
        }
    }
}

/// Spawn croc with the given args + CROC_SECRET, stream events, register the
/// killer for cancel. Returns once the process is launched (it keeps running in
/// a background thread).
pub fn spawn_transfer(
    app: AppHandle,
    transfer_id: String,
    args: Vec<String>,
    secret: String,
    work_dir: Option<std::path::PathBuf>,
    auto_answer_prompts: bool,
) -> Result<(), String> {
    let bin = find_croc_binary()
        .ok_or("croc binary not found. Install croc (e.g. `brew install croc`) or set CROC_BIN.")?;

    #[allow(unused_mut)]
    let mut env: Vec<(String, String)> = vec![("CROC_SECRET".into(), secret)];

    // Widen PATH so a PATH-resolved croc is findable (the bundled sidecar is used
    // via an absolute path regardless). The extra dirs are Unix-only; on Windows
    // appending them with the wrong separator would just corrupt PATH, so skip it.
    #[cfg(desktop)]
    {
        let path = std::env::var("PATH").unwrap_or_default();
        #[cfg(not(windows))]
        env.push((
            "PATH".into(),
            format!("{path}:/opt/homebrew/bin:/usr/local/bin"),
        ));
        #[cfg(windows)]
        env.push(("PATH".into(), path));
    }

    // Android has no pty to read a width from, so croc falls back to $COLUMNS (then
    // 80) — and at 80 columns it truncates the filenames the UI shows. This is the
    // pipe-transport equivalent of the desktop pty's cols=1000.
    #[cfg(mobile)]
    {
        env.push(("COLUMNS".into(), "1000".into()));
        // croc writes its config (and the --internal-dns marker) under HOME, and
        // temp files under TMPDIR. Neither is set in an Android app process, so
        // point both at app-private storage or croc writes where it may not.
        if let Some(dir) = crate::commands::android_home_dir(&app) {
            env.push(("HOME".into(), dir.to_string_lossy().into_owned()));
        }
        if let Some(dir) = crate::commands::android_tmp_dir(&app) {
            env.push(("TMPDIR".into(), dir.to_string_lossy().into_owned()));
        }
    }

    // When sending a folder, croc writes a temp `<name>.zip` into its CWD and only
    // deletes it on a clean exit. A per-send scratch dir keeps that zip out of the
    // user's home dir and lets us wipe leftovers after a failed transfer, so a retry
    // never hits croc's un-overridable "file already exists!" (utils.go ZipDirectory).
    let cwd = work_dir.clone().or_else(|| fallback_cwd(&app));
    let transport::Spawned {
        mut reader,
        writer,
        killer,
        wait,
    } = transport::spawn(bin, &args, &env, cwd.as_ref())?;

    {
        let state = app.state::<CrocState>();
        state
            .transfers
            .lock()
            .unwrap()
            .insert(transfer_id.clone(), Transfer { killer, writer });
    }

    std::thread::spawn(move || {
        use std::io::Read;
        let mut parser = Parser::new(app.clone(), transfer_id.clone(), auto_answer_prompts);
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => parser.ingest(&String::from_utf8_lossy(&buf[..n])),
                Err(_) => break,
            }
        }
        parser.finalize(wait());
        let state = app.state::<CrocState>();
        state.transfers.lock().unwrap().remove(&transfer_id);
        // Remove the scratch dir (and any leftover temp zip croc didn't clean up
        // because the transfer failed) so the next send starts from a clean slate.
        if let Some(dir) = work_dir {
            let _ = std::fs::remove_dir_all(&dir);
        }
    });

    Ok(())
}

/// Working dir when the caller didn't supply a scratch one.
///
/// This MUST be writable on Android. croc makes its temp files with
/// `os.CreateTemp(".", "croc-stdin-")` (croc utils.go / cli.go) — hardcoded to the
/// current directory and ignoring TMPDIR — and an Android app process starts with
/// cwd `/`, which is read-only. Any invocation without an explicit scratch dir (text
/// sends, receives) therefore died with `open ./croc-stdin-…: read-only file system`
/// and exit 1, after the PAKE handshake had already succeeded.
///
/// Desktop keeps its old behaviour: HOME on Unix, USERPROFILE on Windows.
fn fallback_cwd(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(mobile)]
    {
        // Same directory we hand croc as TMPDIR, so all of its scratch lands together.
        crate::commands::android_tmp_dir(app)
    }
    #[cfg(desktop)]
    {
        let _ = app;
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The transport contract, exercised against the real pty backend: output is
    /// readable, the exit code is reported, and stderr is interleaved with stdout.
    /// The Android pipe backend can't run on the host, so this guards the half we
    /// can reach — and both are held to the same shape by `transport::Spawned`.
    #[cfg(desktop)]
    #[test]
    fn transport_reads_output_and_exit_code() {
        use std::io::Read;

        let spawned = transport::spawn(
            PathBuf::from("/bin/sh"),
            &[
                "-c".to_string(),
                // stderr first: if a transport dropped it, croc's progress bar
                // (which goes to stderr) would vanish and the UI would sit empty.
                "printf 'from-stderr\\n' >&2; printf 'from-stdout %s\\n' \"$CROC_TEST_ENV\"; exit 3"
                    .to_string(),
            ],
            &[("CROC_TEST_ENV".to_string(), "passed".to_string())],
            None,
        )
        .expect("spawn failed");

        let transport::Spawned {
            mut reader, wait, ..
        } = spawned;
        let mut out = String::new();
        let _ = reader.read_to_string(&mut out);

        assert!(
            out.contains("from-stderr"),
            "stderr must reach the parser: {out:?}"
        );
        assert!(
            out.contains("from-stdout passed"),
            "stdout + env must pass through: {out:?}"
        );
        assert_eq!(wait(), 3, "exit code must be reported for finalize()");
    }

    /// Desktop must hand croc exactly what the user typed — rewriting a relay to an
    /// IP is an Android-only workaround for the missing platform resolver.
    #[cfg(desktop)]
    #[test]
    fn resolve_relay_is_identity_on_desktop() {
        assert_eq!(
            resolve_relay("croc.schollz.com:9009"),
            "croc.schollz.com:9009"
        );
        assert!(platform_global_flags().is_empty());
    }
}
