use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Emitter;
use std::time::Duration;

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
}

#[derive(Deserialize)]
pub struct SetupParams {
    pub auth_choice: String,
    pub key_flag: String,
    pub api_key: String,
}

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

/// Resolve the bundled Node.js binary and OpenClaw entry point.
/// Falls back to system-installed openclaw if bundled resources not found.
fn resolve_paths(resource_dir: &Option<PathBuf>) -> Result<(PathBuf, PathBuf), String> {
    // Check bundled resources (production)
    if let Some(res) = resource_dir {
        let node_bin = res.join("node-aarch64-apple-darwin");
        let openclaw_mjs = res.join("openclaw").join("openclaw.mjs");

        if node_bin.exists() && openclaw_mjs.exists() {
            return Ok((node_bin, openclaw_mjs));
        }
    }

    // Dev mode: check src-tauri/resources/ directly
    let dev_resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    let dev_node = dev_resources.join("node-aarch64-apple-darwin");
    let dev_openclaw = dev_resources.join("openclaw").join("openclaw.mjs");
    if dev_node.exists() && dev_openclaw.exists() {
        return Ok((dev_node, dev_openclaw));
    }

    // Fallback: try system-installed openclaw
    let output = Command::new("sh")
        .arg("-lc")
        .arg("which node && echo '---' && npm root -g")
        .output()
        .map_err(|e| format!("Failed to find system Node: {}", e))?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        let parts: Vec<&str> = text.trim().split("---").collect();
        if parts.len() == 2 {
            let node = PathBuf::from(parts[0].trim());
            let openclaw = PathBuf::from(format!("{}/openclaw/openclaw.mjs", parts[1].trim()));
            if node.exists() && openclaw.exists() {
                return Ok((node, openclaw));
            }
        }
    }

    Err("OpenClaw not found. Neither bundled resources nor system install available.".to_string())
}

/// Run a bundled openclaw command and return stdout
fn run_openclaw_cmd(resource_dir: &Option<PathBuf>, args: &[&str]) -> Result<String, String> {
    let (node_bin, openclaw_mjs) = resolve_paths(resource_dir)?;

    let output = Command::new(&node_bin)
        .arg(&openclaw_mjs)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run openclaw: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() || !stdout.is_empty() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("openclaw exited {}: {}", output.status.code().unwrap_or(-1), stderr))
    }
}

/// Check if OpenClaw is initialized (device.json + openclaw.json exist)
#[tauri::command]
pub fn engine_init_check() -> Result<bool, String> {
    let state_dir = openclaw_state_dir()?;
    let has_identity = state_dir.join("identity").join("device.json").exists();
    let has_config = state_dir.join("openclaw.json").exists();
    Ok(has_identity && has_config)
}

/// Run openclaw onboard — spawns in background thread and emits event when done
#[tauri::command]
pub fn engine_setup(
    app: tauri::AppHandle,
    params: SetupParams,
) {
    std::thread::spawn(move || {
        let mut cmd_str = String::from(
            "openclaw onboard --non-interactive --accept-risk --install-daemon --mode local --gateway-auth token --flow quickstart --skip-channels --skip-skills --skip-search"
        );

        if !params.auth_choice.is_empty() {
            cmd_str.push_str(&format!(" --auth-choice {}", params.auth_choice));
        }

        if !params.key_flag.is_empty() && !params.api_key.is_empty() {
            cmd_str.push_str(&format!(" {} \"{}\"", params.key_flag, params.api_key));
        }

        let _ = Command::new("sh")
            .arg("-lc")
            .arg(&cmd_str)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();

        // Check if setup succeeded
        let success = home_dir()
            .map(|h| h.join(".openclaw/identity/device.json").exists())
            .unwrap_or(false);

        // Emit event to frontend — this bypasses the invoke handler
        let _ = app.emit("engine-setup-complete", success);
    });
}

/// Auto-approve all pending device pairing requests
#[tauri::command]
pub fn engine_auto_pair() -> Result<(), String> {
    let state_dir = openclaw_state_dir()?;

    // Read the gateway token
    let config_str = fs::read_to_string(state_dir.join("openclaw.json"))
        .map_err(|e| format!("Failed to read config: {}", e))?;

    // Extract token value
    let token = config_str
        .find("\"token\"")
        .and_then(|i| {
            let rest = &config_str[i..];
            let colon = rest.find(':')?;
            let after = &rest[colon + 1..];
            let q1 = after.find('"')?;
            let after_q1 = &after[q1 + 1..];
            let q2 = after_q1.find('"')?;
            Some(after_q1[..q2].to_string())
        })
        .ok_or("Failed to extract gateway token")?;

    // Read pending devices
    let pending_path = state_dir.join("devices").join("pending.json");
    if !pending_path.exists() {
        return Ok(());
    }
    let pending_str = fs::read_to_string(&pending_path).unwrap_or_default();

    // Extract all requestId values
    let mut pos = 0;
    let mut request_ids: Vec<String> = Vec::new();
    while let Some(idx) = pending_str[pos..].find("\"requestId\"") {
        let rest = &pending_str[pos + idx..];
        if let Some(colon) = rest.find(':') {
            let after = &rest[colon + 1..];
            if let Some(q1) = after.find('"') {
                let after_q1 = &after[q1 + 1..];
                if let Some(q2) = after_q1.find('"') {
                    request_ids.push(after_q1[..q2].to_string());
                }
            }
        }
        pos += idx + 12;
    }

    // Approve each with sh -lc (uses system openclaw)
    for req_id in &request_ids {
        let _ = Command::new("sh")
            .arg("-lc")
            .arg(format!("openclaw devices approve {} --token {}", req_id, token))
            .output();
    }

    Ok(())
}

#[tauri::command]
pub async fn engine_ensure_running(
    state: tauri::State<'_, EngineProcess>,
) -> Result<EngineStatus, String> {
    let port = *state.port.lock().unwrap();

    // Already running?
    if is_port_open(port) {
        let child_guard = state.child.lock().unwrap();
        return Ok(EngineStatus {
            running: true,
            port,
            pid: child_guard.as_ref().map(|c| c.id()),
            managed: child_guard.is_some(),
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

    // Wait for port (up to 30s) — longer timeout for first run when plugins install
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
            return Ok(EngineStatus {
                running: true,
                port,
                pid: Some(pid),
                managed: true,
            });
        }
    }

    Err(format!("OpenClaw started (pid {}) but port {} not available after 30s", pid, port))
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
