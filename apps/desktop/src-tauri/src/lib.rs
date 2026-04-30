use std::process::Command as StdCommand;

#[tauri::command]
fn run_shell(cmd: String) -> Result<String, String> {
    let output = StdCommand::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output()
        .map_err(|e| format!("spawn failed: {}", e))?;

    // Always return stdout, even on non-zero exit
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
        .invoke_handler(tauri::generate_handler![greet, run_shell, spawn_shell])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
