use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct PtyState {
    sessions: Mutex<HashMap<u32, PtySession>>,
    next_id: Mutex<u32>,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    pair: portable_pty::PtyPair,
    child: Box<dyn portable_pty::Child + Send>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }
}

#[derive(Serialize, Clone)]
struct PtyOutput {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct PtyExit {
    id: u32,
    code: Option<u32>,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: tauri::State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    command: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    if let Some(command) = command {
        cmd.arg("-lc");
        cmd.arg(command);
    } else {
        cmd.arg("-l"); // login shell
    }

    // Set working directory
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    } else if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }

    // Inherit essential env vars (Superset allowlist pattern)
    for key in &[
        "HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "LC_ALL",
        "LC_CTYPE", "LC_MESSAGES", "LC_COLLATE",
        "SSH_AUTH_SOCK", "SSH_AGENT_PID",
        "NVM_DIR", "PYENV_ROOT", "GOPATH", "CARGO_HOME", "RUSTUP_HOME",
        "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
        "ZDOTDIR", "EDITOR", "VISUAL", "PAGER",
    ] {
        if let Ok(val) = std::env::var(key) {
            cmd.env(key, val);
        }
    }
    // Superset terminal env vars
    cmd.env("TERM", "xterm-256color");
    cmd.env("TERM_PROGRAM", "kitty");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("COLORFGBG", "15;0"); // dark theme
    cmd.env("CLICOLOR", "1");
    cmd.env("FORCE_COLOR", "1");
    // Ensure UTF-8 locale
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {}", e))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer: {}", e))?;

    // Assign session ID
    let id = {
        let mut next = state.next_id.lock().unwrap();
        let id = *next;
        *next += 1;
        id
    };

    // Store session
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(
            id,
            PtySession {
                writer,
                pair,
                child,
            },
        );
    }

    // Spawn reader thread — streams output to frontend via Tauri events
    let app_handle = app.clone();
    let session_id = id;
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("pty-output", PtyOutput { id: session_id, data });
                }
                Err(_) => break,
            }
        }
        // PTY closed — check exit status
        let _ = app_handle.emit("pty-exit", PtyExit { id: session_id, code: None });
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("session not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("session not found")?;
    session
        .pair
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<'_, PtyState>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
