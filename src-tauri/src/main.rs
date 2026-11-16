#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ollama;
mod storage;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
static QUITTING: AtomicBool = AtomicBool::new(false);
#[tauri::command]
fn finish_quit(app: tauri::AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(ollama::Transport::new()?);
            app.manage(storage::initialize(app.handle()));
            let menu = tauri::menu::Menu::default(app.handle())?;
            for item in menu.items()? {
                if let Some(submenu) = item.as_submenu() {
                    if submenu.text()? == "File" {
                        submenu.append(&tauri::menu::MenuItem::with_id(
                            app,
                            "export-backup",
                            "Export backup…",
                            true,
                            None::<&str>,
                        )?)?;
                    }
                }
            }
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "export-backup" {
                    let _ = app.emit("prepare-export", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ollama::list_models,
            ollama::start_reply,
            ollama::cancel_reply,
            storage::load_workspace,
            storage::save_workspace,
            storage::export_backup,
            finish_quit,
            storage::confirm_exit_without_saving
        ])
        .build(tauri::generate_context!())
        .expect("afterlight could not start")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } if !QUITTING.load(Ordering::SeqCst) => {
                api.prevent_exit();
                let _ = app.emit("prepare-quit", ());
            }
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                api.prevent_close();
                let _ = app.emit("prepare-quit", ());
            }
            _ => {}
        });
}
