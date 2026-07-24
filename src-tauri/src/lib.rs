mod clipboard;
mod codephrase;
mod commands;
mod croc;
mod history;

use croc::CrocState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sharekit::init())
        .plugin(tauri_plugin_notification::init())
        .manage(CrocState::default())
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
            commands::croc_clipboard_files,
            commands::croc_clipboard_text,
            commands::croc_set_progress,
            commands::croc_save_temp_file,
            commands::croc_history_list,
            commands::croc_history_add,
            commands::croc_history_remove,
            commands::croc_history_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
