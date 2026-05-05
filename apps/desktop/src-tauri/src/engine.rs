use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

const DEFAULT_PORT: u16 = 18789;

pub struct EngineProcess {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
    pub resource_dir: Mutex<Option<PathBuf>>,
}

impl Default for EngineProcess {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(DEFAULT_PORT),
            resource_dir: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct EngineStatus {
    pub running: bool,
    pub port: u16,
    pub pid: Option<u32>,
    pub managed: bool,
    pub identity: Option<IdentityInfo>,
}

#[derive(Serialize, Clone)]
pub struct IdentityInfo {
    pub device_id: String,
    pub public_key_pem: String,
    pub private_key_pem: String,
    pub token: String,
}

fn load_identity() -> Option<IdentityInfo> {
    let state_dir = openclaw_state_dir().ok()?;
    let device_str = fs::read_to_string(state_dir.join("identity/device.json")).ok()?;
    let device: serde_json::Value = serde_json::from_str(&device_str).ok()?;
    let config_str = fs::read_to_string(state_dir.join("openclaw.json")).ok()?;
    Some(IdentityInfo {
        device_id: device["deviceId"].as_str()?.to_string(),
        public_key_pem: device["publicKeyPem"].as_str()?.to_string(),
        private_key_pem: device["privateKeyPem"].as_str()?.to_string(),
        token: json_get_string(&config_str, "/gateway/auth/token")?,
    })
}

#[derive(Deserialize)]
pub struct SetupParams {
    pub auth_choice: String,
    pub key_flag: String,
    pub api_key: String,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn is_port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}

fn home_dir() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "HOME not set".to_string())
}

fn openclaw_state_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".openclaw"))
}

/// Extract a string value from a JSON string by key path using serde_json
fn json_get_string(json_str: &str, pointer: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json_str).ok()?;
    value.pointer(pointer)?.as_str().map(String::from)
}

/// Extract all values for a key from a JSON object (searches recursively)
fn json_collect_strings(json_str: &str, key: &str) -> Vec<String> {
    let value: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let mut results = Vec::new();
    fn collect(value: &serde_json::Value, key: &str, results: &mut Vec<String>) {
        match value {
            serde_json::Value::Object(map) => {
                if let Some(v) = map.get(key) {
                    if let Some(s) = v.as_str() {
                        results.push(s.to_string());
                    }
                }
                for v in map.values() {
                    collect(v, key, results);
                }
            }
            serde_json::Value::Array(arr) => {
                for v in arr {
                    collect(v, key, results);
                }
            }
            _ => {}
        }
    }
    collect(&value, key, &mut results);
    results
}

// ─── Path Resolution ──────────────────────────────────────────────────────────

/// Resolve the bundled Node.js binary and OpenClaw entry point.
/// In production: from Tauri resource_dir (app bundle).
/// In dev: from src-tauri/resources/.
/// NO system fallback — the app is self-contained.
fn resolve_paths(resource_dir: &Option<PathBuf>) -> Result<(PathBuf, PathBuf), String> {
    // Production: Tauri resource_dir
    if let Some(res) = resource_dir {
        let node_bin = res.join("node-aarch64-apple-darwin");
        let openclaw_mjs = res.join("openclaw").join("openclaw.mjs");
        if node_bin.exists() && openclaw_mjs.exists() {
            return Ok((node_bin, openclaw_mjs));
        }
    }

    // Dev mode: CARGO_MANIFEST_DIR/resources/
    let dev_resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    let dev_node = dev_resources.join("node-aarch64-apple-darwin");
    let dev_openclaw = dev_resources.join("openclaw").join("openclaw.mjs");
    if dev_node.exists() && dev_openclaw.exists() {
        return Ok((dev_node, dev_openclaw));
    }

    // Last resort fallback: find system node + openclaw via NVM
    let home = std::env::var("HOME").unwrap_or_default();
    let nvm_node = format!("{home}/.nvm/versions/node");
    if let Ok(entries) = fs::read_dir(&nvm_node) {
        for entry in entries.flatten() {
            let node_bin = entry.path().join("bin/node");
            let openclaw_mjs = entry.path().join("lib/node_modules/openclaw/openclaw.mjs");
            if node_bin.exists() && openclaw_mjs.exists() {
                return Ok((node_bin, openclaw_mjs));
            }
        }
    }

    Err("Bundled OpenClaw not found. The app may need to be reinstalled.".to_string())
}

/// Run an openclaw command using the bundled node + openclaw.mjs
fn run_openclaw(resource_dir: &Option<PathBuf>, args: &[&str]) -> Result<String, String> {
    let (node_bin, openclaw_mjs) = resolve_paths(resource_dir)?;

    let output = Command::new(&node_bin)
        .arg(&openclaw_mjs)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run openclaw: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() || !stdout.is_empty() {
        Ok(stdout)
    } else {
        Err(format!("openclaw exited {}: {}", output.status.code().unwrap_or(-1), stderr))
    }
}

// ─── Commands: Init & Setup ───────────────────────────────────────────────────

/// Check if OpenClaw is initialized (device.json + openclaw.json exist)
#[tauri::command]
pub fn engine_init_check() -> Result<bool, String> {
    let state_dir = openclaw_state_dir()?;
    let has_identity = state_dir.join("identity").join("device.json").exists();
    let has_config = state_dir.join("openclaw.json").exists();
    Ok(has_identity && has_config)
}

/// Check if the config file exists (for detecting deletion)
#[tauri::command]
pub fn engine_config_exists() -> Result<bool, String> {
    let state_dir = openclaw_state_dir()?;
    Ok(state_dir.join("openclaw.json").exists())
}

/// Read the current gateway token from config
#[tauri::command]
pub fn engine_read_token() -> Result<String, String> {
    let state_dir = openclaw_state_dir()?;
    let config_str = fs::read_to_string(state_dir.join("openclaw.json"))
        .map_err(|e| format!("Failed to read config: {}", e))?;
    json_get_string(&config_str, "/gateway/auth/token")
        .ok_or_else(|| "No gateway token found in config".to_string())
}

/// Run openclaw onboard — spawns in background thread and emits event when done
#[tauri::command]
pub fn engine_setup(
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineProcess>,
    params: SetupParams,
) {
    let resource_dir = state.resource_dir.lock().unwrap().clone();

    std::thread::spawn(move || {
        let mut args: Vec<String> = vec![
            "onboard".into(),
            "--non-interactive".into(),
            "--accept-risk".into(),
            "--skip-daemon".into(),
            "--skip-health".into(),
            "--mode".into(), "local".into(),
            "--gateway-auth".into(), "token".into(),
            "--flow".into(), "quickstart".into(),
            "--skip-channels".into(),
            "--skip-skills".into(),
            "--skip-search".into(),
        ];

        if !params.auth_choice.is_empty() {
            args.push("--auth-choice".into());
            args.push(params.auth_choice.clone());
        }

        if !params.key_flag.is_empty() && !params.api_key.is_empty() {
            args.push(params.key_flag.clone());
            args.push(params.api_key.clone());
        }

        let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let _ = run_openclaw(&resource_dir, &str_args);

        // Check workspace was created (more reliable than exit code)
        let home = home_dir().unwrap_or_default();
        let has_identity = home.join(".openclaw/identity/device.json").exists();
        let has_workspace = home.join(".openclaw/workspace/IDENTITY.md").exists();

        let _ = app.emit("engine-setup-complete", has_identity || has_workspace);
    });
}

/// Auto-approve all pending device pairing requests
#[tauri::command]
pub fn engine_auto_pair(
    state: tauri::State<'_, EngineProcess>,
) -> Result<(), String> {
    let state_dir = openclaw_state_dir()?;
    let resource_dir = state.resource_dir.lock().unwrap().clone();

    // Read the gateway token
    let config_str = fs::read_to_string(state_dir.join("openclaw.json"))
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let token = json_get_string(&config_str, "/gateway/auth/token")
        .ok_or("Failed to extract gateway token")?;

    // Read pending devices
    let pending_path = state_dir.join("devices").join("pending.json");
    if !pending_path.exists() {
        return Ok(());
    }
    let pending_str = fs::read_to_string(&pending_path).unwrap_or_default();
    let request_ids = json_collect_strings(&pending_str, "requestId");

    // Approve each pending request using bundled openclaw
    for req_id in &request_ids {
        let _ = run_openclaw(
            &resource_dir,
            &["devices", "approve", req_id.as_str(), "--token", token.as_str()],
        );
    }

    Ok(())
}

/// Run an arbitrary openclaw command using bundled binaries
#[tauri::command]
pub fn xcloud_run(
    state: tauri::State<'_, EngineProcess>,
    args: Vec<String>,
) -> Result<String, String> {
    let resource_dir = state.resource_dir.lock().unwrap().clone();
    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_openclaw(&resource_dir, &str_args)
}

// ─── Commands: Gateway Lifecycle ──────────────────────────────────────────────

#[tauri::command]
pub async fn engine_ensure_running(
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineProcess>,
) -> Result<EngineStatus, String> {
    let port = *state.port.lock().unwrap();

    // Already running?
    if is_port_open(port) {
        // Auto-approve pending devices in background (don't block)
        let resource_dir_clone = state.resource_dir.lock().unwrap().clone();
        std::thread::spawn(move || {
            auto_pair_devices(&resource_dir_clone);
        });

        let child_guard = state.child.lock().unwrap();
        return Ok(EngineStatus {
            running: true,
            port,
            pid: child_guard.as_ref().map(|c| c.id()),
            managed: child_guard.is_some(),
            identity: load_identity(),
        });
    }

    // Clear dead child
    {
        let mut child_guard = state.child.lock().unwrap();
        if let Some(ref mut child) = *child_guard {
            match child.try_wait() {
                Ok(Some(_)) | Err(_) => { *child_guard = None; }
                Ok(None) => {}
            }
        }
    }

    // Resolve bundled paths
    let resource_dir = state.resource_dir.lock().unwrap().clone();
    let (node_bin, openclaw_mjs) = resolve_paths(&resource_dir)?;

    // Start gateway using bundled Node + OpenClaw
    let child = Command::new(&node_bin)
        .arg(&openclaw_mjs)
        .arg("gateway")
        .arg("--port")
        .arg(port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start OpenClaw: {}", e))?;

    let pid = child.id();
    {
        let mut child_guard = state.child.lock().unwrap();
        *child_guard = Some(child);
    }

    // Wait for port (up to 30s for first run when plugins install)
    for _ in 0..100 {
        std::thread::sleep(Duration::from_millis(300));

        {
            let mut child_guard = state.child.lock().unwrap();
            if let Some(ref mut c) = *child_guard {
                match c.try_wait() {
                    Ok(Some(status)) => {
                        *child_guard = None;
                        return Err(format!("OpenClaw exited with status: {}", status));
                    }
                    Err(e) => {
                        *child_guard = None;
                        return Err(format!("Process check failed: {}", e));
                    }
                    Ok(None) => {}
                }
            }
        }

        if is_port_open(port) {
            // Auto-approve pending devices in background
            let resource_dir_clone2 = state.resource_dir.lock().unwrap().clone();
            std::thread::spawn(move || {
                auto_pair_devices(&resource_dir_clone2);
            });

            // Start health monitor
            let monitor_app = app.clone();
            let monitor_port = port;
            std::thread::spawn(move || {
                gateway_health_monitor(monitor_app, monitor_port);
            });

            return Ok(EngineStatus {
                running: true,
                port,
                pid: Some(pid),
                managed: true,
                identity: load_identity(),
            });
        }
    }

    Err(format!("OpenClaw started (pid {}) but port {} not available after 30s", pid, port))
}

/// Auto-approve all pending device pairing requests (called internally, not via invoke)
fn auto_pair_devices(resource_dir: &Option<PathBuf>) {
    let state_dir = match openclaw_state_dir() {
        Ok(d) => d,
        Err(_) => return,
    };

    let config_str = match fs::read_to_string(state_dir.join("openclaw.json")) {
        Ok(s) => s,
        Err(_) => return,
    };

    let token = match json_get_string(&config_str, "/gateway/auth/token") {
        Some(t) => t,
        None => return,
    };

    let pending_path = state_dir.join("devices").join("pending.json");
    if !pending_path.exists() {
        return;
    }

    let pending_str = fs::read_to_string(&pending_path).unwrap_or_default();
    let request_ids = json_collect_strings(&pending_str, "requestId");

    for req_id in &request_ids {
        let _ = run_openclaw(
            resource_dir,
            &["devices", "approve", req_id.as_str(), "--token", token.as_str()],
        );
    }
}

/// Background thread that monitors gateway health and emits events on crash
fn gateway_health_monitor(app: tauri::AppHandle, port: u16) {
    loop {
        std::thread::sleep(Duration::from_secs(5));

        let state = app.state::<EngineProcess>();

        // Check if child still exists
        {
            let child_guard = state.child.lock().unwrap();
            if child_guard.is_none() {
                // Gateway was stopped intentionally
                break;
            }
        }

        // Check if process exited
        {
            let mut child_guard = state.child.lock().unwrap();
            if let Some(ref mut c) = *child_guard {
                match c.try_wait() {
                    Ok(Some(status)) => {
                        *child_guard = None;
                        let _ = app.emit("engine-gateway-crashed",
                            format!("Gateway exited with status: {}", status));
                        break;
                    }
                    Err(e) => {
                        *child_guard = None;
                        let _ = app.emit("engine-gateway-crashed",
                            format!("Process check failed: {}", e));
                        break;
                    }
                    Ok(None) => {} // Still running
                }
            } else {
                break;
            }
        }

        // Check port connectivity
        if !is_port_open(port) {
            let _ = app.emit("engine-gateway-unresponsive", ());
        }
    }
}

#[tauri::command]
pub async fn engine_status(state: tauri::State<'_, EngineProcess>) -> Result<EngineStatus, String> {
    let port = *state.port.lock().unwrap();
    let child_guard = state.child.lock().unwrap();
    Ok(EngineStatus {
        running: is_port_open(port),
        port,
        pid: child_guard.as_ref().map(|c| c.id()),
        managed: child_guard.is_some(),
        identity: load_identity(),
    })
}

#[tauri::command]
pub async fn engine_stop(state: tauri::State<'_, EngineProcess>) -> Result<bool, String> {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(ref mut child) = *child_guard {
        #[cfg(unix)]
        unsafe { libc::kill(child.id() as i32, libc::SIGTERM); }
        #[cfg(not(unix))]
        { let _ = child.kill(); }

        std::thread::sleep(Duration::from_secs(2));
        match child.try_wait() {
            Ok(Some(_)) => {}
            _ => { let _ = child.kill(); let _ = child.wait(); }
        }
        *child_guard = None;
        Ok(true)
    } else {
        Ok(false)
    }
}

pub fn cleanup(state: &EngineProcess) {
    let mut child_guard = state.child.lock().unwrap();
    if let Some(ref mut child) = *child_guard {
        #[cfg(unix)]
        unsafe { libc::kill(child.id() as i32, libc::SIGTERM); }
        std::thread::sleep(Duration::from_millis(500));
        let _ = child.kill();
        let _ = child.wait();
        *child_guard = None;
    }
}
