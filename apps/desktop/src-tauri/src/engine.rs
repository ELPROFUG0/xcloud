use serde::Serialize;
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

const DEFAULT_PORT: u16 = 18789;

pub struct EngineProcess {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
}

impl Default for EngineProcess {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(DEFAULT_PORT),
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

fn is_port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}

fn find_openclaw_binary() -> Result<String, String> {
    // Try `which openclaw`
    if let Ok(output) = Command::new("sh").arg("-c").arg("which openclaw").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path);
            }
        }
    }

    // Try common paths
    for p in &["/usr/local/bin/openclaw", "/opt/homebrew/bin/openclaw"] {
        if std::path::Path::new(p).exists() {
            return Ok(p.to_string());
        }
    }

    // Try login shell (NVM)
    if let Ok(output) = Command::new("sh").arg("-lc").arg("which openclaw").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path);
            }
        }
    }

    Err("OpenClaw not found. Install with: npm install -g openclaw@latest".to_string())
}

#[tauri::command]
pub async fn engine_ensure_running(state: tauri::State<'_, EngineProcess>) -> Result<EngineStatus, String> {
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

    // Start gateway
    let openclaw_path = find_openclaw_binary()?;

    let child = Command::new("sh")
        .arg("-lc")
        .arg(format!("{} gateway --port {}", openclaw_path, port))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start OpenClaw: {}", e))?;

    let pid = child.id();
    {
        let mut child_guard = state.child.lock().unwrap();
        *child_guard = Some(child);
    }

    // Wait for port (up to 15s) — async command runs on thread pool, won't block UI
    for _ in 0..50 {
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

    Err(format!("OpenClaw started (pid {}) but port {} not available after 15s", pid, port))
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
