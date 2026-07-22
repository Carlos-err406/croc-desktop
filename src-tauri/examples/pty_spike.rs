// De-risking spike: spawn `croc` inside a real PTY via portable-pty and stream
// its output — the make-or-break test for the Tauri rewrite. croc only prints
// its code/progress when attached to a TTY (hence node-pty in the Electron app;
// this proves the same works from Rust, incl. the cols=1000 no-truncation trick).
//
// Run: cargo run --example pty_spike
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::time::Duration;

fn main() {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 1000, pixel_width: 0, pixel_height: 0 })
        .expect("openpty failed");

    // `croc send --text` registers a one-time code with the relay and waits for a
    // peer — it prints the code + join instructions, which is enough to prove the
    // PTY pipe streams croc's TTY-gated output. We kill it after a few seconds.
    let mut cmd = CommandBuilder::new("croc");
    cmd.args(["send", "--text", "tauri pty spike"]);

    let mut child = pair.slave.spawn_command(cmd).expect("spawn croc failed");
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().expect("clone reader failed");

    let reader_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut captured = String::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    print!("{chunk}");
                    captured.push_str(&chunk);
                }
                Err(_) => break,
            }
        }
        captured
    });

    std::thread::sleep(Duration::from_secs(5));
    child.kill().expect("kill failed");
    let captured = reader_thread.join().unwrap_or_default();

    println!("\n\n===== SPIKE RESULT =====");
    println!("captured {} bytes", captured.len());
    let saw_code = captured.to_lowercase().contains("code is")
        || captured.contains("croc ")
        || captured.to_lowercase().contains("on the other");
    println!(
        "PTY streamed croc output: {}",
        if saw_code { "YES ✓ (make-or-break PASSED)" } else { "no code line seen — check output above" }
    );
}
