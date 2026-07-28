fn main() {
    // Android 15+ moves to a 16 KB memory page size, and a device with a 16 KB-page
    // kernel cannot load a shared library whose ELF LOAD segments are aligned to the
    // old 4 KB. Rust's default for aarch64-linux-android is still 4 KB, so an
    // Android 16 device shows "This app isn't 16 KB compatible … libapp_lib.so: LOAD
    // segment not aligned" (a warning on a 4 KB-page device, a load failure on a
    // 16 KB one).
    //
    // `cargo:rustc-link-arg` rather than RUSTFLAGS or .cargo/config.toml: it applies
    // to exactly the artifact this crate produces and can't be silently overridden by
    // a RUSTFLAGS env var, which Tauri's Android build sets.
    //
    // croc needs nothing here — Go already emits 64 KB-aligned segments
    // (p_align=0x10000) for android/arm64.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }

    tauri_build::build()
}
