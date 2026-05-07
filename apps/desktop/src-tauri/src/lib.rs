mod audio;
mod engine;
mod pty;

use std::process::Command as StdCommand;
use tauri::Manager;

#[tauri::command]
fn run_shell(cmd: String) -> Result<String, String> {
    let output = StdCommand::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output()
        .map_err(|e| format!("spawn failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !stdout.is_empty() {
        Ok(stdout)
    } else if output.status.success() {
        Ok(String::new())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("exit {}: {}", output.status.code().unwrap_or(-1), stderr))
    }
}

#[tauri::command]
fn spawn_shell(cmd: String) -> Result<u32, String> {
    let child = StdCommand::new("sh")
        .arg("-c")
        .arg(&cmd)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(child.id())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(engine::EngineProcess::default())
        .manage(audio::AudioState::default())
        .manage(pty::PtyState::default())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // Resolve bundled resource directory and store it
            if let Ok(resource_dir) = app.path().resource_dir() {
                let state = app.state::<engine::EngineProcess>();
                *state.resource_dir.lock().unwrap() = Some(resource_dir);
            }

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                use window_vibrancy::NSVisualEffectState;
                #[allow(deprecated)]
                apply_vibrancy(&window, NSVisualEffectMaterial::UltraDark, Some(NSVisualEffectState::Active), None)
                    .expect("Failed to apply vibrancy");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let state = app.state::<engine::EngineProcess>();
                engine::cleanup(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            run_shell,
            spawn_shell,
            audio::local_speech_status,
            audio::prepare_local_speech,
            audio::transcribe_audio,
            audio::transcribe_audio_background,
            engine::engine_ensure_running,
            engine::engine_status,
            engine::engine_stop,
            engine::engine_init_check,
            engine::engine_config_exists,
            engine::engine_read_token,
            engine::engine_setup,
            engine::engine_auto_pair,
            engine::xcloud_run,
            engine::xcloud_shell_command,
            engine::xcloud_auth_profiles_status,
            engine::xcloud_disconnect_auth_provider,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
