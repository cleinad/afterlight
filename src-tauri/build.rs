fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_models",
            "start_reply",
            "cancel_reply",
            "load_workspace",
            "save_workspace",
            "finish_quit",
            "export_backup",
            "confirm_exit_without_saving",
        ]),
    ))
    .expect("failed to generate Tauri build configuration");
}
