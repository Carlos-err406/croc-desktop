mod clipboard;
mod codephrase;
mod commands;
mod croc;
mod history;

use croc::CrocState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_imports)]
    use tauri::{Emitter, Manager};

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sharekit::init())
        .plugin(tauri_plugin_notification::init())
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::croc_default_dir,
            commands::croc_info,
            commands::croc_stat_paths,
            commands::croc_pick_paths,
            commands::croc_pick_folder,
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
            // dock icon) arrive here. Buffer them and ping the UI to stage & send.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if !paths.is_empty() {
                    _app_handle
                        .state::<commands::OpenedPaths>()
                        .0
                        .lock()
                        .unwrap()
                        .extend(paths);
                    let _ = _app_handle.emit("croc://open-files", ());
                    if let Some(w) = _app_handle.get_webview_window("main") {
                        let _ = w.set_focus();
                    }
                }
            }
        });
}
