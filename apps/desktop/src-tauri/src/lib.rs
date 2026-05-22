mod audio;
mod engine;
mod pty;

use std::process::Command as StdCommand;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
async fn run_shell(cmd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| format!("shell task failed: {}", e))?
}

#[tauri::command]
async fn spawn_shell(cmd: String) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let child = StdCommand::new("sh")
            .arg("-c")
            .arg(&cmd)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(child.id())
    })
    .await
    .map_err(|e| format!("spawn task failed: {}", e))?
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn read_openclaw_media(path: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not available".to_string())?;
        let media_root = home.join(".openclaw").join("media");
        let requested = if let Some(rest) = path.strip_prefix("~/") {
            home.join(rest)
        } else {
            PathBuf::from(path)
        };

        let media_root = media_root
            .canonicalize()
            .map_err(|e| format!("media root unavailable: {}", e))?;
        let requested = requested
            .canonicalize()
            .map_err(|e| format!("media file unavailable: {}", e))?;

        if !requested.starts_with(&media_root) {
            return Err("media path is outside the OpenClaw media directory".to_string());
        }

        std::fs::read(requested).map_err(|e| format!("read media failed: {}", e))
    })
    .await
    .map_err(|e| format!("media task failed: {}", e))?
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
            read_openclaw_media,
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
            engine::engine_ssh_key_prepare,
            engine::engine_ssh_tunnel_start,
            engine::engine_ssh_tunnel_status,
            engine::engine_ssh_tunnel_stop,
            engine::engine_oauth_callback_tunnel_start,
            engine::engine_oauth_callback_tunnel_stop,
            engine::engine_oauth_redirect_capture_start,
            engine::engine_oauth_redirect_capture_stop,
            engine::engine_oauth_redirect_capture_take,
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
