use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

const DEFAULT_PORT: u16 = 18789;
const UNICORE_WORKSPACE_PLUGIN_ID: &str = "unicore-workspace";
const WORKSPACE_AGENT_CREATE_TOOL: &str = "workspace_agent_create";
const XCLOUD_CONTEXT_TOOL: &str = "xcloud_context";
const XCLOUD_UI_ACTION_TOOL: &str = "xcloud_ui_action";
const XCLOUD_AGENT_CREATE_TOOL: &str = "xcloud_agent_create";
const XCLOUD_AGENT_UI_CREATE_TOOL: &str = "xcloud_agent_ui_create";
const UNICORE_WORKSPACE_PLUGIN_JSON: &str =
    include_str!("../unicore-openclaw-extensions/unicore-workspace/openclaw.plugin.json");
const UNICORE_WORKSPACE_PLUGIN_INDEX: &str =
    include_str!("../unicore-openclaw-extensions/unicore-workspace/index.js");
const UNICORE_WORKSPACE_PLUGIN_PACKAGE: &str =
    include_str!("../unicore-openclaw-extensions/unicore-workspace/package.json");

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthProfilesStatus {
    pub openai_codex: bool,
    pub github_copilot: bool,
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

fn write_text_if_changed(path: &Path, contents: &str) -> Result<bool, String> {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(false);
    }

    fs::write(path, contents)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    Ok(true)
}

fn ensure_unicore_workspace_extension(openclaw_mjs: &Path) -> Result<bool, String> {
    let openclaw_root = openclaw_mjs
        .parent()
        .ok_or_else(|| "OpenClaw entry point has no parent directory".to_string())?;
    let plugin_dir = openclaw_root
        .join("dist")
        .join("extensions")
        .join(UNICORE_WORKSPACE_PLUGIN_ID);

    fs::create_dir_all(&plugin_dir)
        .map_err(|e| format!("Failed to create {}: {}", plugin_dir.display(), e))?;

    let mut changed = false;
    changed |= write_text_if_changed(
        &plugin_dir.join("openclaw.plugin.json"),
        UNICORE_WORKSPACE_PLUGIN_JSON,
    )?;
    changed |= write_text_if_changed(&plugin_dir.join("index.js"), UNICORE_WORKSPACE_PLUGIN_INDEX)?;
    changed |= write_text_if_changed(
        &plugin_dir.join("package.json"),
        UNICORE_WORKSPACE_PLUGIN_PACKAGE,
    )?;
    Ok(changed)
}

fn ensure_unicore_workspace_config() -> Result<bool, String> {
    let config_path = openclaw_state_dir()?.join("openclaw.json");
    if !config_path.exists() {
        return Ok(false);
    }

    let raw = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse config: {}", e))?;
    let root = match config.as_object_mut() {
        Some(root) => root,
        None => return Ok(false),
    };

    let mut changed = false;

    {
        if !root.get("plugins").is_some_and(|value| value.is_object()) {
            root.insert("plugins".into(), serde_json::json!({}));
            changed = true;
        }
        let plugins = root
            .get_mut("plugins")
            .and_then(|value| value.as_object_mut())
            .expect("plugins object was just inserted");

        if !plugins.get("entries").is_some_and(|value| value.is_object()) {
            plugins.insert("entries".into(), serde_json::json!({}));
            changed = true;
        }
        let entries = plugins
            .get_mut("entries")
            .and_then(|value| value.as_object_mut())
            .expect("plugin entries object was just inserted");

        match entries.get_mut(UNICORE_WORKSPACE_PLUGIN_ID) {
            Some(entry) if entry.is_object() => {
                let entry = entry
                    .as_object_mut()
                    .expect("plugin entry object was just checked");
                if entry.get("enabled") != Some(&serde_json::Value::Bool(true)) {
                    entry.insert("enabled".into(), serde_json::Value::Bool(true));
                    changed = true;
                }
            }
            _ => {
                entries.insert(
                    UNICORE_WORKSPACE_PLUGIN_ID.into(),
                    serde_json::json!({ "enabled": true }),
                );
                changed = true;
            }
        }
    }

    {
        if !root.get("tools").is_some_and(|value| value.is_object()) {
            root.insert("tools".into(), serde_json::json!({}));
            changed = true;
        }
        let tools = root
            .get_mut("tools")
            .and_then(|value| value.as_object_mut())
            .expect("tools object was just inserted");

        if !tools.get("alsoAllow").is_some_and(|value| value.is_array()) {
            tools.insert("alsoAllow".into(), serde_json::json!([]));
            changed = true;
        }
        let also_allow = tools
            .get_mut("alsoAllow")
            .and_then(|value| value.as_array_mut())
            .expect("alsoAllow array was just inserted");

        for tool_name in [
            WORKSPACE_AGENT_CREATE_TOOL,
            XCLOUD_CONTEXT_TOOL,
            XCLOUD_UI_ACTION_TOOL,
            XCLOUD_AGENT_CREATE_TOOL,
            XCLOUD_AGENT_UI_CREATE_TOOL,
        ] {
            if !also_allow
                .iter()
                .any(|value| value.as_str() == Some(tool_name))
            {
                also_allow.push(serde_json::Value::String(tool_name.to_string()));
                changed = true;
            }
        }
    }

    if changed {
        let next = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, format!("{}\n", next))
            .map_err(|e| format!("Failed to save config: {}", e))?;
    }

    Ok(changed)
}

fn ensure_unicore_workspace_runtime(resource_dir: &Option<PathBuf>) -> Result<bool, String> {
    let (_node_bin, openclaw_mjs) = resolve_paths(resource_dir)?;
    let extension_changed = ensure_unicore_workspace_extension(&openclaw_mjs)?;
    let config_changed = ensure_unicore_workspace_config()?;
    Ok(extension_changed || config_changed)
}

/// Run an openclaw command using the bundled node + openclaw.mjs
fn run_openclaw(resource_dir: &Option<PathBuf>, args: &[&str]) -> Result<String, String> {
    let (node_bin, openclaw_mjs) = resolve_paths(resource_dir)?;
    let _ = ensure_unicore_workspace_extension(&openclaw_mjs);
    let _ = ensure_unicore_workspace_config();

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

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}

fn openclaw_shell_command(resource_dir: &Option<PathBuf>, args: &[String]) -> Result<String, String> {
    let (node_bin, openclaw_mjs) = resolve_paths(resource_dir)?;
    let _ = ensure_unicore_workspace_extension(&openclaw_mjs);
    let _ = ensure_unicore_workspace_config();
    let mut parts = vec![
        shell_quote(&node_bin.to_string_lossy()),
        shell_quote(&openclaw_mjs.to_string_lossy()),
    ];

    parts.extend(args.iter().map(|arg| shell_quote(arg)));
    Ok(parts.join(" "))
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

        // Append Composio instructions to AGENTS.md if it exists
        let home = home_dir().unwrap_or_default();
        let agents_md = home.join(".openclaw/workspace/AGENTS.md");
        if agents_md.exists() {
            let content = fs::read_to_string(&agents_md).unwrap_or_default();
            if !content.contains("Composio Integrations") {
                let composio_block = r#"

## Composio Integrations

You have access to Composio MCP tools for connecting and using external apps. The user may have connected apps like Gmail, Notion, Slack, GitHub, etc. via OAuth in the app's Settings → Integrations.

### Available tools:
- **COMPOSIO_SEARCH_TOOLS** — Search for available tools by use case
- **COMPOSIO_MANAGE_CONNECTIONS** — Add, list, or remove app connections
- **COMPOSIO_WAIT_FOR_CONNECTIONS** — Poll until a connection becomes active

### Workflow:
1. Call `COMPOSIO_SEARCH_TOOLS` with the user's request to find relevant tools
2. If no active connection, call `COMPOSIO_MANAGE_CONNECTIONS` to initiate OAuth
3. Share the auth link and call `COMPOSIO_WAIT_FOR_CONNECTIONS`
4. Once connected, execute the toolkit tools directly

### Important:
- Never execute a toolkit tool without an ACTIVE connection
- Connected apps are managed through Composio's OAuth — no API keys needed
- To connect a new app, use COMPOSIO_MANAGE_CONNECTIONS with action "add"
"#;
                let _ = fs::write(&agents_md, format!("{}{}", content, composio_block));
            }
        }

        let has_identity = home.join(".openclaw/identity/device.json").exists();
        let has_workspace = agents_md.exists();

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

/// Build a shell command that runs bundled OpenClaw in the embedded terminal.
#[tauri::command]
pub fn xcloud_shell_command(
    state: tauri::State<'_, EngineProcess>,
    args: Vec<String>,
) -> Result<String, String> {
    let resource_dir = state.resource_dir.lock().unwrap().clone();
    openclaw_shell_command(&resource_dir, &args)
}

/// Read local auth profile availability without probing remote models.
#[tauri::command]
pub fn xcloud_auth_profiles_status() -> Result<AuthProfilesStatus, String> {
    let state_dir = openclaw_state_dir()?;
    let profiles_path = state_dir
        .join("agents")
        .join("main")
        .join("agent")
        .join("auth-profiles.json");

    let profiles_str = match fs::read_to_string(profiles_path) {
        Ok(contents) => contents,
        Err(_) => {
            return Ok(AuthProfilesStatus {
                openai_codex: false,
                github_copilot: false,
            });
        }
    };

    let value: serde_json::Value = serde_json::from_str(&profiles_str)
        .map_err(|e| format!("Failed to read auth profiles: {}", e))?;

    let profiles = value
        .get("profiles")
        .and_then(|profiles| profiles.as_object());

    let has_provider = |provider: &str| -> bool {
        profiles
            .map(|profiles| {
                profiles.values().any(|profile| {
                    profile
                        .get("provider")
                        .and_then(|value| value.as_str())
                        .is_some_and(|value| value == provider)
                })
            })
            .unwrap_or(false)
    };

    Ok(AuthProfilesStatus {
        openai_codex: has_provider("openai-codex"),
        github_copilot: has_provider("github-copilot"),
    })
}

/// Remove all local auth profiles for a provider.
#[tauri::command]
pub fn xcloud_disconnect_auth_provider(provider: String) -> Result<AuthProfilesStatus, String> {
    let state_dir = openclaw_state_dir()?;
    let profiles_path = state_dir
        .join("agents")
        .join("main")
        .join("agent")
        .join("auth-profiles.json");

    let profiles_str = match fs::read_to_string(&profiles_path) {
        Ok(contents) => contents,
        Err(_) => return xcloud_auth_profiles_status(),
    };

    let mut value: serde_json::Value = serde_json::from_str(&profiles_str)
        .map_err(|e| format!("Failed to read auth profiles: {}", e))?;

    if let Some(profiles) = value
        .get_mut("profiles")
        .and_then(|profiles| profiles.as_object_mut())
    {
        profiles.retain(|_, profile| {
            profile
                .get("provider")
                .and_then(|value| value.as_str())
                .is_none_or(|value| value != provider)
        });
    }

    let updated = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to write auth profiles: {}", e))?;
    fs::write(&profiles_path, format!("{}\n", updated))
        .map_err(|e| format!("Failed to save auth profiles: {}", e))?;

    xcloud_auth_profiles_status()
}

// ─── Commands: Gateway Lifecycle ──────────────────────────────────────────────

#[tauri::command]
pub async fn engine_ensure_running(
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineProcess>,
) -> Result<EngineStatus, String> {
    let port = *state.port.lock().unwrap();
    let resource_dir = state.resource_dir.lock().unwrap().clone();
    let runtime_changed = ensure_unicore_workspace_runtime(&resource_dir).unwrap_or(false);

    // Already running?
    if is_port_open(port) {
        if runtime_changed {
            let mut child_guard = state.child.lock().unwrap();
            if let Some(ref mut child) = *child_guard {
                #[cfg(unix)]
                unsafe { libc::kill(child.id() as i32, libc::SIGTERM); }
                #[cfg(not(unix))]
                {
                    let _ = child.kill();
                }
                std::thread::sleep(Duration::from_secs(2));
                match child.try_wait() {
                    Ok(Some(_)) => {}
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                *child_guard = None;
            } else {
                return Ok(EngineStatus {
                    running: true,
                    port,
                    pid: None,
                    managed: false,
                    identity: load_identity(),
                });
            }
        } else {
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
