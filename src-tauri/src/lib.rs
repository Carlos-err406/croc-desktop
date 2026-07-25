mod clipboard;
mod codephrase;
mod commands;
mod croc;
mod history;

use croc::CrocState;

/// Buffer files opened via "Open With → Croc Desktop" (or dropped on the app
/// icon) and ping the UI to stage & send them, focusing the window. Shared by the
/// macOS RunEvent::Opened path and the Windows/Linux argv path.
fn stage_opened_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    use tauri::{Emitter, Manager};
    if paths.is_empty() {
        return;
    }
    app.state::<commands::OpenedPaths>()
        .0
        .lock()
        .unwrap()
        .extend(paths);
    let _ = app.emit("croc://open-files", ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
}

/// Extract existing file/dir paths from a launch argv (Open-With on Windows/Linux
/// passes the file as a CLI arg). Skips the binary, flags, and `croc://` deep
/// links (those are forwarded to the deep-link plugin's on_open_url).
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn opened_paths_from_argv(argv: &[String]) -> Vec<String> {
    argv.iter()
        .skip(1) // program name
        .filter(|a| !a.starts_with('-') && !a.starts_with("croc://"))
        .filter(|a| std::path::Path::new(a).exists())
        .cloned()
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_imports)]
    use tauri::{Emitter, Manager};

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Single-instance must be registered FIRST. Windows/Linux only — it routes a
    // second launch's deep link / opened file into the already-running window.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::Manager;
            // croc:// URLs are auto-forwarded to on_open_url by the deep-link
            // feature; here we handle Open-With file paths.
            let paths = opened_paths_from_argv(&argv);
            if paths.is_empty() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            } else {
                stage_opened_paths(app, paths);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sharekit::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(CrocState::default())
        .manage(commands::OpenedPaths::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Cold-start Open-With on Windows/Linux: the file arrives in argv
            // (macOS delivers it via RunEvent::Opened instead). Buffer it now; the
            // frontend drains OpenedPaths via takeOpenedFiles() on launch.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                let argv: Vec<String> = std::env::args().collect();
                let paths = opened_paths_from_argv(&argv);
                if !paths.is_empty() {
                    app.state::<commands::OpenedPaths>()
                        .0
                        .lock()
                        .unwrap()
                        .extend(paths);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::croc_default_dir,
            commands::croc_info,
            commands::croc_update_size,
            commands::croc_stat_paths,
            commands::croc_pick_paths,
            commands::croc_pick_folder,
            commands::croc_pick_folders,
            commands::croc_send,
            commands::croc_send_text,
            commands::croc_receive,
            commands::croc_respond,
            commands::croc_relay_test,
            commands::croc_cancel,
            commands::croc_show_item,
            commands::croc_open_url,
            commands::croc_clipboard_files,
            commands::croc_clipboard_text,
            commands::croc_set_progress,
            commands::croc_save_temp_file,
            commands::croc_history_list,
            commands::croc_history_add,
            commands::croc_history_remove,
            commands::croc_history_clear,
            commands::croc_take_opened_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // macOS: files opened via "Open With → Croc Desktop" (or dropped on the
            // dock icon) arrive here as file:// URLs. croc:// deep links are handled
            // by the deep-link plugin's own RunEvent hook, so filtering to file
            // paths here leaves them untouched.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                stage_opened_paths(_app_handle, paths);
            }
        });
}
