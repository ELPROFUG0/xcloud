use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
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
    pub tunnel_child: Mutex<Option<Child>>,
    pub tunnel_local_port: Mutex<Option<u16>>,
    pub oauth_tunnel_child: Mutex<Option<Child>>,
    pub oauth_tunnel_local_port: Mutex<Option<u16>>,
    pub oauth_capture_stop: Mutex<Option<mpsc::Sender<()>>>,
    pub oauth_capture_port: Mutex<Option<u16>>,
    pub oauth_capture_result: Arc<Mutex<Option<String>>>,
    pub port: Mutex<u16>,
    pub resource_dir: Mutex<Option<PathBuf>>,
}

impl Default for EngineProcess {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            tunnel_child: Mutex::new(None),
            tunnel_local_port: Mutex::new(None),
            oauth_tunnel_child: Mutex::new(None),
            oauth_tunnel_local_port: Mutex::new(None),
            oauth_capture_stop: Mutex::new(None),
            oauth_capture_port: Mutex::new(None),
            oauth_capture_result: Arc::new(Mutex::new(None)),
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelParams {
    pub host: String,
    pub user: Option<String>,
    pub ssh_port: Option<u16>,
    pub local_port: Option<u16>,
    pub remote_port: Option<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelStatus {
    pub running: bool,
    pub local_port: u16,
    pub pid: Option<u32>,
    pub url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthRedirectCaptureStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OAuthRedirectCaptured {
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    pub private_key_path: String,
    pub public_key_path: String,
    pub public_key: String,
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

fn terminate_child(child: &mut Child, grace: Duration) {
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }

    std::thread::sleep(grace);
    match child.try_wait() {
        Ok(Some(_)) => {}
        _ => {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn validate_ssh_part(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("SSH {} is required.", label));
    }
    if value.chars().any(char::is_whitespace) {
        return Err(format!("SSH {} cannot contain spaces.", label));
    }
    Ok(())
}

fn xcloud_ssh_key_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".ssh").join("xcloud_openclaw_host"))
}

fn prepare_xcloud_ssh_key() -> Result<SshKeyInfo, String> {
    let key_path = xcloud_ssh_key_path()?;
    let public_key_path = key_path.with_extension("pub");
    let ssh_dir = key_path
        .parent()
        .ok_or_else(|| "SSH key path has no parent directory".to_string())?;

    fs::create_dir_all(ssh_dir)
        .map_err(|e| format!("Failed to create {}: {}", ssh_dir.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(ssh_dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to secure {}: {}", ssh_dir.display(), e))?;
    }

    if !key_path.exists() {
        let output = Command::new("ssh-keygen")
            .arg("-t")
            .arg("ed25519")
            .arg("-N")
            .arg("")
            .arg("-C")
            .arg("xcloud-openclaw-host")
            .arg("-f")
            .arg(&key_path)
            .output()
            .map_err(|e| format!("Failed to run ssh-keygen: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "ssh-keygen failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }

    if !public_key_path.exists() {
        let output = Command::new("ssh-keygen")
            .arg("-y")
            .arg("-f")
            .arg(&key_path)
            .output()
            .map_err(|e| format!("Failed to export SSH public key: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "Failed to export SSH public key: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        fs::write(&public_key_path, &output.stdout)
            .map_err(|e| format!("Failed to write {}: {}", public_key_path.display(), e))?;
    }

    let public_key = fs::read_to_string(&public_key_path)
        .map_err(|e| format!("Failed to read {}: {}", public_key_path.display(), e))?
        .trim()
        .to_string();
    if public_key.is_empty() {
        return Err("Generated SSH public key is empty.".to_string());
    }

    Ok(SshKeyInfo {
        private_key_path: key_path.display().to_string(),
        public_key_path: public_key_path.display().to_string(),
        public_key,
    })
}

fn read_child_stderr(child: &mut Child) -> String {
    let mut output = String::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = stderr.read_to_string(&mut output);
    }
    output.trim().to_string()
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
        .env("OPENCLAW_ALLOW_INSECURE_PRIVATE_WS", "1")
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
pub async fn engine_ssh_key_prepare() -> Result<SshKeyInfo, String> {
    tauri::async_runtime::spawn_blocking(prepare_xcloud_ssh_key)
        .await
        .map_err(|e| format!("SSH key task failed: {}", e))?
}

#[tauri::command]
pub async fn engine_ssh_tunnel_start(
    state: tauri::State<'_, EngineProcess>,
    params: SshTunnelParams,
) -> Result<SshTunnelStatus, String> {
    let host = params.host.trim().to_string();
    let user = params.user.unwrap_or_else(|| "root".to_string()).trim().to_string();
    let ssh_port = params.ssh_port.unwrap_or(22);
    let local_port = params.local_port.unwrap_or(18790);
    let remote_port = params.remote_port.unwrap_or(DEFAULT_PORT);

    validate_ssh_part(&host, "host")?;
    validate_ssh_part(&user, "user")?;

    if local_port == 0 || remote_port == 0 || ssh_port == 0 {
        return Err("SSH ports must be valid positive numbers.".to_string());
    }

    let url = format!("ws://127.0.0.1:{}", local_port);

    {
        let mut tunnel_guard = state.tunnel_child.lock().unwrap();
        let mut local_port_guard = state.tunnel_local_port.lock().unwrap();
        if let Some(ref mut child) = *tunnel_guard {
            match child.try_wait() {
                Ok(None) if *local_port_guard == Some(local_port) && is_port_open(local_port) => {
                    return Ok(SshTunnelStatus {
                        running: true,
                        local_port,
                        pid: Some(child.id()),
                        url,
                    });
                }
                Ok(None) => {
                    terminate_child(child, Duration::from_millis(500));
                }
                Ok(Some(_)) | Err(_) => {}
            }
            *tunnel_guard = None;
            *local_port_guard = None;
        }
    }

    // Reuse an existing external tunnel if the requested local port is already open.
    if is_port_open(local_port) {
        *state.tunnel_local_port.lock().unwrap() = Some(local_port);
        return Ok(SshTunnelStatus {
            running: true,
            local_port,
            pid: None,
            url,
        });
    }

    let target = format!("{}@{}", user, host);
    let key_path = xcloud_ssh_key_path().ok().filter(|path| path.exists());
    let mut command = Command::new("ssh");
    command
        .arg("-N")
        .arg("-L")
        .arg(format!("{}:127.0.0.1:{}", local_port, remote_port))
        .arg("-p")
        .arg(ssh_port.to_string())
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new");
    if let Some(path) = key_path {
        command
            .arg("-i")
            .arg(path)
            .arg("-o")
            .arg("IdentitiesOnly=yes");
    }
    let child = command
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start SSH tunnel: {}", e))?;

    let pid = child.id();
    {
        let mut tunnel_guard = state.tunnel_child.lock().unwrap();
        let mut local_port_guard = state.tunnel_local_port.lock().unwrap();
        *tunnel_guard = Some(child);
        *local_port_guard = Some(local_port);
    }

    for _ in 0..80 {
        std::thread::sleep(Duration::from_millis(100));
        if is_port_open(local_port) {
            return Ok(SshTunnelStatus {
                running: true,
                local_port,
                pid: Some(pid),
                url,
            });
        }

        let mut tunnel_guard = state.tunnel_child.lock().unwrap();
        if let Some(ref mut child) = *tunnel_guard {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let details = read_child_stderr(child);
                    *tunnel_guard = None;
                    *state.tunnel_local_port.lock().unwrap() = None;
                    let detail_suffix = if details.is_empty() {
                        String::new()
                    } else {
                        format!(" SSH said: {}", details)
                    };
                    return Err(format!(
                        "SSH tunnel exited before opening local port {} ({}).{} Make sure SSH access works for this host, then try again.",
                        local_port, status, detail_suffix
                    ));
                }
                Err(e) => {
                    *tunnel_guard = None;
                    *state.tunnel_local_port.lock().unwrap() = None;
                    return Err(format!("SSH tunnel process check failed: {}", e));
                }
                Ok(None) => {}
            }
        }
    }

    {
        let mut tunnel_guard = state.tunnel_child.lock().unwrap();
        if let Some(ref mut child) = *tunnel_guard {
            terminate_child(child, Duration::from_millis(500));
            let details = read_child_stderr(child);
            if !details.is_empty() {
                *tunnel_guard = None;
                *state.tunnel_local_port.lock().unwrap() = None;
                return Err(format!(
                    "SSH tunnel could not open local port {}. SSH said: {}",
                    local_port, details
                ));
            }
        }
        *tunnel_guard = None;
        *state.tunnel_local_port.lock().unwrap() = None;
    }

    Err(format!(
        "SSH tunnel could not open local port {}. Make sure SSH key login works with `ssh -p {} {}@{}` and that OpenClaw is running on the host.",
        local_port, ssh_port, user, host
    ))
}

fn parse_http_request_target(buffer: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(buffer);
    let line = text.lines().next()?.trim();
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    if method != "GET" {
        return None;
    }
    parts.next().map(|value| value.to_string())
}

fn write_oauth_capture_response(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        status,
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn handle_oauth_capture_request(
    mut stream: TcpStream,
    port: u16,
    app: &tauri::AppHandle,
    result_store: &Arc<Mutex<Option<String>>>,
) -> bool {
    let mut buffer = [0_u8; 8192];
    let read = match stream.read(&mut buffer) {
        Ok(read) => read,
        Err(_) => return false,
    };
    let Some(target) = parse_http_request_target(&buffer[..read]) else {
        write_oauth_capture_response(
            &mut stream,
            "400 Bad Request",
            "<!doctype html><meta charset=\"utf-8\"><title>xCloud OAuth</title><body>Invalid OAuth callback request.</body>",
        );
        return false;
    };

    let path = target.split('?').next().unwrap_or("");
    if path != "/auth/callback" {
        write_oauth_capture_response(
            &mut stream,
            "404 Not Found",
            "<!doctype html><meta charset=\"utf-8\"><title>xCloud OAuth</title><body>OAuth callback route not found.</body>",
        );
        return false;
    }

    let url = if target.starts_with("http://") || target.starts_with("https://") {
        target
    } else {
        format!("http://localhost:{}{}", port, target)
    };
    *result_store.lock().unwrap() = Some(url.clone());
    let _ = app.emit("engine-oauth-redirect-captured", OAuthRedirectCaptured { url });
    write_oauth_capture_response(
        &mut stream,
        "200 OK",
        "<!doctype html><meta charset=\"utf-8\"><title>xCloud OAuth</title><body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#111;color:#fff;display:grid;place-items:center;height:100vh;margin:0\"><main style=\"text-align:center\"><h1 style=\"font-size:18px;font-weight:600\">Authentication captured</h1><p style=\"color:#aaa\">You can close this window and return to xCloud.</p></main></body>",
    );
    true
}

fn stop_oauth_capture(state: &EngineProcess) -> bool {
    let mut guard = state.oauth_capture_stop.lock().unwrap();
    if let Some(stop) = guard.take() {
        let _ = stop.send(());
        *state.oauth_capture_port.lock().unwrap() = None;
        return true;
    }
    *state.oauth_capture_port.lock().unwrap() = None;
    false
}

#[tauri::command]
pub async fn engine_oauth_redirect_capture_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineProcess>,
    port: Option<u16>,
) -> Result<OAuthRedirectCaptureStatus, String> {
    let port = port.unwrap_or(1455);
    if port == 0 {
        return Err("OAuth callback port must be a valid positive number.".to_string());
    }

    {
        let guard = state.oauth_capture_stop.lock().unwrap();
        let active_port = *state.oauth_capture_port.lock().unwrap();
        let has_pending_result = state.oauth_capture_result.lock().unwrap().is_some();
        if guard.is_some() && active_port == Some(port) && !has_pending_result {
            return Ok(OAuthRedirectCaptureStatus {
                running: true,
                port,
                url: format!("http://localhost:{}/auth/callback", port),
            });
        }
    }

    stop_oauth_capture(&state);
    *state.oauth_capture_result.lock().unwrap() = None;

    let mut listeners = Vec::new();
    let mut errors = Vec::new();
    for address in [format!("127.0.0.1:{}", port), format!("[::1]:{}", port)] {
        match TcpListener::bind(&address) {
            Ok(listener) => {
                listener
                    .set_nonblocking(true)
                    .map_err(|e| format!("OAuth callback listener failed: {}", e))?;
                listeners.push(listener);
            }
            Err(err) => errors.push(format!("{} ({})", address, err)),
        }
    }

    if listeners.is_empty() {
        return Err(format!(
            "OAuth callback port {} is already in use on this computer. Close the previous login tab/process and try again. Details: {}",
            port,
            errors.join("; ")
        ));
    }

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let handled = Arc::new(AtomicBool::new(false));
    let app_handle = app.clone();
    let result_store = state.oauth_capture_result.clone();
    thread::spawn(move || loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }

        for listener in &listeners {
            match listener.accept() {
                Ok((stream, _)) => {
                    if handled.load(Ordering::SeqCst) {
                        continue;
                    }
                    if handle_oauth_capture_request(stream, port, &app_handle, &result_store) {
                        handled.store(true, Ordering::SeqCst);
                        return;
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => {}
            }
        }

        thread::sleep(Duration::from_millis(25));
    });

    *state.oauth_capture_stop.lock().unwrap() = Some(stop_tx);
    *state.oauth_capture_port.lock().unwrap() = Some(port);

    Ok(OAuthRedirectCaptureStatus {
        running: true,
        port,
        url: format!("http://localhost:{}/auth/callback", port),
    })
}

#[tauri::command]
pub async fn engine_ssh_tunnel_status(
    state: tauri::State<'_, EngineProcess>,
) -> Result<Option<SshTunnelStatus>, String> {
    let mut tunnel_guard = state.tunnel_child.lock().unwrap();
    let local_port = *state.tunnel_local_port.lock().unwrap();
    let Some(local_port) = local_port else {
        return Ok(None);
    };
    let url = format!("ws://127.0.0.1:{}", local_port);

    if let Some(ref mut child) = *tunnel_guard {
        match child.try_wait() {
            Ok(None) => {
                return Ok(Some(SshTunnelStatus {
                    running: is_port_open(local_port),
                    local_port,
                    pid: Some(child.id()),
                    url,
                }));
            }
            Ok(Some(_)) | Err(_) => {
                *tunnel_guard = None;
                *state.tunnel_local_port.lock().unwrap() = None;
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn engine_ssh_tunnel_stop(state: tauri::State<'_, EngineProcess>) -> Result<bool, String> {
    let mut tunnel_guard = state.tunnel_child.lock().unwrap();
    if let Some(ref mut child) = *tunnel_guard {
        terminate_child(child, Duration::from_millis(500));
        *tunnel_guard = None;
        *state.tunnel_local_port.lock().unwrap() = None;
        return Ok(true);
    }
    *state.tunnel_local_port.lock().unwrap() = None;
    Ok(false)
}

#[tauri::command]
pub async fn engine_oauth_callback_tunnel_start(
    state: tauri::State<'_, EngineProcess>,
    params: SshTunnelParams,
) -> Result<SshTunnelStatus, String> {
    let host = params.host.trim().to_string();
    let user = params.user.unwrap_or_else(|| "root".to_string()).trim().to_string();
    let ssh_port = params.ssh_port.unwrap_or(22);
    let local_port = params.local_port.unwrap_or(1455);
    let remote_port = params.remote_port.unwrap_or(1455);

    validate_ssh_part(&host, "host")?;
    validate_ssh_part(&user, "user")?;

    if local_port == 0 || remote_port == 0 || ssh_port == 0 {
        return Err("SSH ports must be valid positive numbers.".to_string());
    }

    stop_oauth_capture(&state);
    *state.oauth_capture_result.lock().unwrap() = None;

    let url = format!("http://127.0.0.1:{}", local_port);
    {
        let mut tunnel_guard = state.oauth_tunnel_child.lock().unwrap();
        let mut local_port_guard = state.oauth_tunnel_local_port.lock().unwrap();
        if let Some(ref mut child) = *tunnel_guard {
            match child.try_wait() {
                Ok(None) if *local_port_guard == Some(local_port) && is_port_open(local_port) => {
                    return Ok(SshTunnelStatus {
                        running: true,
                        local_port,
                        pid: Some(child.id()),
                        url,
                    });
                }
                Ok(None) => terminate_child(child, Duration::from_millis(500)),
                Ok(Some(_)) | Err(_) => {}
            }
            *tunnel_guard = None;
            *local_port_guard = None;
        }
    }

    if is_port_open(local_port) {
        return Err(format!(
            "OAuth callback port {} is already in use on this computer. Close the previous login tab/process and try again.",
            local_port
        ));
    }

    let target = format!("{}@{}", user, host);
    let key_path = xcloud_ssh_key_path().ok().filter(|path| path.exists());
    let mut command = Command::new("ssh");
    command
        .arg("-N")
        .arg("-L")
        .arg(format!("{}:127.0.0.1:{}", local_port, remote_port))
        .arg("-p")
        .arg(ssh_port.to_string())
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3")
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new");
    if let Some(path) = key_path {
        command
            .arg("-i")
            .arg(path)
            .arg("-o")
            .arg("IdentitiesOnly=yes");
    }

    let child = command
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start OAuth callback tunnel: {}", e))?;

    let pid = child.id();
    {
        let mut tunnel_guard = state.oauth_tunnel_child.lock().unwrap();
        let mut local_port_guard = state.oauth_tunnel_local_port.lock().unwrap();
        *tunnel_guard = Some(child);
        *local_port_guard = Some(local_port);
    }

    for _ in 0..50 {
        std::thread::sleep(Duration::from_millis(100));
        if is_port_open(local_port) {
            return Ok(SshTunnelStatus {
                running: true,
                local_port,
                pid: Some(pid),
                url,
            });
        }

        let mut tunnel_guard = state.oauth_tunnel_child.lock().unwrap();
        if let Some(ref mut child) = *tunnel_guard {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let details = read_child_stderr(child);
                    *tunnel_guard = None;
                    *state.oauth_tunnel_local_port.lock().unwrap() = None;
                    let detail_suffix = if details.is_empty() {
                        String::new()
                    } else {
                        format!(" SSH said: {}", details)
                    };
                    return Err(format!(
                        "OAuth callback tunnel exited before opening local port {} ({}).{}",
                        local_port, status, detail_suffix
                    ));
                }
                Err(e) => {
                    *tunnel_guard = None;
                    *state.oauth_tunnel_local_port.lock().unwrap() = None;
                    return Err(format!("OAuth callback tunnel process check failed: {}", e));
                }
                Ok(None) => {}
            }
        }
    }

    {
        let mut tunnel_guard = state.oauth_tunnel_child.lock().unwrap();
        if let Some(ref mut child) = *tunnel_guard {
            terminate_child(child, Duration::from_millis(500));
            let details = read_child_stderr(child);
            if !details.is_empty() {
                *tunnel_guard = None;
                *state.oauth_tunnel_local_port.lock().unwrap() = None;
                return Err(format!(
                    "OAuth callback tunnel could not open local port {}. SSH said: {}",
                    local_port, details
                ));
            }
        }
        *tunnel_guard = None;
        *state.oauth_tunnel_local_port.lock().unwrap() = None;
    }

    Err(format!(
        "OAuth callback tunnel could not open local port {}. Make sure SSH key login works with `ssh -p {} {}@{}`.",
        local_port, ssh_port, user, host
    ))
}

#[tauri::command]
pub async fn engine_oauth_callback_tunnel_stop(
    state: tauri::State<'_, EngineProcess>,
) -> Result<bool, String> {
    let mut tunnel_guard = state.oauth_tunnel_child.lock().unwrap();
    if let Some(ref mut child) = *tunnel_guard {
        terminate_child(child, Duration::from_millis(500));
        *tunnel_guard = None;
        *state.oauth_tunnel_local_port.lock().unwrap() = None;
        return Ok(true);
    }
    *state.oauth_tunnel_local_port.lock().unwrap() = None;
    Ok(false)
}

#[tauri::command]
pub async fn engine_oauth_redirect_capture_stop(
    state: tauri::State<'_, EngineProcess>,
) -> Result<bool, String> {
    Ok(stop_oauth_capture(&state))
}

#[tauri::command]
pub async fn engine_oauth_redirect_capture_take(
    state: tauri::State<'_, EngineProcess>,
) -> Result<Option<String>, String> {
    Ok(state.oauth_capture_result.lock().unwrap().take())
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
        terminate_child(child, Duration::from_millis(500));
        *child_guard = None;
    }

    let mut tunnel_guard = state.tunnel_child.lock().unwrap();
    if let Some(ref mut child) = *tunnel_guard {
        terminate_child(child, Duration::from_millis(500));
        *tunnel_guard = None;
    }
    *state.tunnel_local_port.lock().unwrap() = None;

    let mut oauth_tunnel_guard = state.oauth_tunnel_child.lock().unwrap();
    if let Some(ref mut child) = *oauth_tunnel_guard {
        terminate_child(child, Duration::from_millis(500));
        *oauth_tunnel_guard = None;
    }
    *state.oauth_tunnel_local_port.lock().unwrap() = None;

    stop_oauth_capture(state);
}
