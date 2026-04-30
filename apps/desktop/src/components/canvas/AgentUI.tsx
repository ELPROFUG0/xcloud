import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Layout, Code, Terminal, FolderOpen, Plus, RefreshCw, ExternalLink, ArrowLeft, X } from "lucide-react";

/** Scaffold the UI workspace with agent context files */
async function scaffoldUI(agentId: string, wsPath: string, home: string): Promise<string> {
  const uiPath = `${home}/${wsPath}/ui`;

  // Create ui directory
  await invoke("run_shell", { cmd: `mkdir -p "${uiPath}"` });

  // Read agent files for context
  const readFile = async (name: string) => {
    try { return await readTextFile(`${wsPath}/${name}`, { baseDir: undefined }); }
    catch { try { return await invoke<string>("run_shell", { cmd: `cat "${home}/${wsPath}/${name}" 2>/dev/null` }); } catch { return ""; } }
  };

  const identity = await readFile("IDENTITY.md");
  const soul = await readFile("SOUL.md");
  const tools = await readFile("TOOLS.md");
  const agents = await readFile("AGENTS.md");

  // Build AGENT-CONTEXT.md
  const context = `# Agent Context

This file describes the AI agent that this UI is being built for.
Read this carefully before building anything.

## Agent ID
\`${agentId}\`

## Identity
${identity || "No identity configured yet."}

## Personality
${soul || "No soul/personality configured yet."}

## Tools & Capabilities
${tools || "No custom tools configured."}

## Agent Configuration
${agents || "Default agent configuration."}

## What This UI Should Do

This UI is the visual interface for this AI agent. The agent runs on OpenClaw
(an AI gateway) and communicates via WebSocket on \`ws://127.0.0.1:18789\`.

The UI should:
- Reflect the agent's personality and purpose
- Provide a way for users to interact with what the agent does
- Be visually clean and modern
- Work as a standalone web app (will be embedded in an iframe)

## Technical Notes
- The UI will be previewed inside Agent Studio (a Tauri desktop app)
- It runs in an iframe, so keep it self-contained
- Use any framework/stack you think fits best
- Include a \`dev\` script in package.json so the preview can auto-launch
- The dev server should respect the \`PORT\` environment variable
`;

  // Build CLAUDE.md for Claude Code
  const claudeMd = `# CLAUDE.md

You are building a UI for an AI agent. Read \`AGENT-CONTEXT.md\` for full details about the agent.

## Guidelines
- Read AGENT-CONTEXT.md first to understand the agent
- Choose the stack that best fits the agent's purpose
- Keep the UI clean, modern, and dark-themed
- Include a \`dev\` script in package.json
- The dev server must respect the \`PORT\` env variable
- The UI will run inside an iframe in a desktop app
- Make it functional, not just pretty — it should serve the agent's purpose
- Start by scaffolding the project, then build the core features
`;

  // Build .cursorrules for Cursor
  const cursorRules = `You are building a UI for an AI agent.

FIRST: Read AGENT-CONTEXT.md in this directory to understand the agent.

RULES:
- Choose the stack that best fits the agent's purpose
- Clean, modern, dark-themed UI
- Include a "dev" script in package.json
- Dev server must respect the PORT env variable
- UI runs inside an iframe in a desktop app
- Make it functional — serve the agent's purpose
- Start by scaffolding the project, then build core features
`;

  // Write files using shell (reliable)
  const writeFile = async (path: string, content: string) => {
    await invoke("run_shell", { cmd: `cat > "${path}" << 'SCAFFOLD_EOF'\n${content}\nSCAFFOLD_EOF` });
  };

  await writeFile(`${uiPath}/AGENT-CONTEXT.md`, context);
  await writeFile(`${uiPath}/CLAUDE.md`, claudeMd);
  await writeFile(`${uiPath}/.cursorrules`, cursorRules);

  return uiPath;
}

export function useAgentUI(_agentId: string, wsPath: string) {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [devServerUrl, setDevServerUrl] = useState<string | null>(null);
  const [devServerLoading, setDevServerLoading] = useState(false);
  const [uiView, setUiView] = useState<"menu" | "create" | "preview">("menu");

  const configPath = `${wsPath}/ui-config.json`;
  const home = "/Users/contentmanager";
  const fullConfigPath = `${home}/${configPath}`;

  // Load saved config
  useEffect(() => {
    invoke<string>("run_shell", { cmd: `cat "${fullConfigPath}" 2>/dev/null || echo "{}"` })
      .then(async (content) => {
        const config = JSON.parse(content);
        if (config.repoPath) {
          setRepoPath(config.repoPath);
          if (config.port) {
            try {
              const status = await invoke<string>("run_shell", {
                cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${config.port} 2>/dev/null || echo "0"`,
              });
              if (["200", "304", "302"].includes(status.trim())) {
                setDevServerUrl(`http://localhost:${config.port}`);
                setUiView("preview");
              }
            } catch { /* */ }
          }
        }
      })
      .catch(() => {});
  }, [fullConfigPath]);

  // Save config
  const saveConfig = useCallback(async (path: string, port?: number) => {
    const config = { repoPath: path, ...(port ? { port } : {}) };
    await invoke("run_shell", { cmd: `echo '${JSON.stringify(config)}' > "${fullConfigPath}"` }).catch(() => {});
  }, [fullConfigPath]);

  // Start dev server
  const startDevServer = useCallback(async (path: string, savedPort?: number) => {
    const cleanPath = path.replace(/\/$/, "");

    // Check if already running on saved port
    if (savedPort) {
      try {
        const status = await invoke<string>("run_shell", {
          cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${savedPort} 2>/dev/null || echo "0"`,
        });
        if (["200", "304", "302"].includes(status.trim())) {
          setDevServerUrl(`http://localhost:${savedPort}`);
          setDevServerLoading(false);
          return;
        }
      } catch { /* */ }
    }

    try {
      const pkgStr = await readTextFile(`${cleanPath}/package.json`).catch(() => "");
      if (pkgStr) {
        const pkg = JSON.parse(pkgStr);
        const script = pkg.scripts?.dev ? "dev" : pkg.scripts?.start ? "start" : null;
        if (script) {
          const port = savedPort ?? (3100 + Math.floor(Math.random() * 900));
          await invoke("spawn_shell", { cmd: `cd "${cleanPath}" && PORT=${port} npm run ${script}` }).catch(() => {});
          saveConfig(path, port);

          let retries = 0;
          while (retries < 30) {
            try {
              const status = await invoke<string>("run_shell", {
                cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} 2>/dev/null || echo "0"`,
              });
              if (["200", "304", "302"].includes(status.trim())) {
                setDevServerUrl(`http://localhost:${port}`);
                setDevServerLoading(false);
                return;
              }
            } catch { /* */ }
            retries++;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }

      const htmlContent = await readTextFile(`${cleanPath}/index.html`).catch(() => "");
      if (htmlContent) {
        setDevServerUrl(`file://${cleanPath}/index.html`);
        setDevServerLoading(false);
        return;
      }
      setDevServerLoading(false);
    } catch {
      setDevServerLoading(false);
    }
  }, [saveConfig]);

  // Select repo
  const selectRepo = useCallback(async () => {
    const selected = await openDialog({ directory: true, title: "Select UI Project" });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : String(selected);
    setRepoPath(path);
    await saveConfig(path);
    setDevServerLoading(true);
    setUiView("preview");
    await startDevServer(path);
  }, [saveConfig, startDevServer]);

  // Disconnect repo
  const disconnectRepo = useCallback(async () => {
    setRepoPath(null);
    setDevServerUrl(null);
    setUiView("menu");
    await invoke("run_shell", { cmd: `rm -f "${fullConfigPath}"` }).catch(() => {});
  }, [fullConfigPath]);

  // Launch preview (from menu or tab switch)
  const launchPreview = useCallback(() => {
    if (!repoPath) return;
    if (devServerUrl) {
      setUiView("preview");
    } else {
      setUiView("preview");
      setDevServerLoading(true);
      startDevServer(repoPath);
    }
  }, [repoPath, devServerUrl, startDevServer]);

  // Create UI — scaffold and open editor
  const createUI = useCallback(async (editor: "cursor" | "claude-code") => {
    const uiPath = await scaffoldUI(_agentId, wsPath, home);
    setRepoPath(uiPath);
    await saveConfig(uiPath);

    if (editor === "cursor") {
      await invoke("run_shell", { cmd: `open -a "Cursor" "${uiPath}"` }).catch(() => {
        // Fallback: try cursor CLI
        invoke("run_shell", { cmd: `cursor "${uiPath}"` }).catch(() => {});
      });
    } else {
      // Create a temp script that opens claude in the project dir
      await invoke("run_shell", { cmd: `echo '#!/bin/bash\ncd "${uiPath}"\nclaude' > /tmp/open-claude.sh && chmod +x /tmp/open-claude.sh && open -a Terminal /tmp/open-claude.sh` }).catch(() => {});
    }
  }, [_agentId, wsPath, home, saveConfig]);

  return {
    repoPath, devServerUrl, devServerLoading, uiView,
    setUiView, selectRepo, disconnectRepo, launchPreview, createUI,
  };
}

/** Header controls for the UI preview */
export function AgentUIHeaderControls({
  uiView, repoPath, devServerUrl, setUiView,
}: {
  uiView: string;
  repoPath: string | null;
  devServerUrl: string | null;
  setUiView: (v: "menu" | "create" | "preview") => void;
}) {
  if (uiView !== "preview") return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-text-muted truncate max-w-[150px]">{repoPath?.split("/").pop()}</span>
      {devServerUrl && (
        <>
          <button
            onClick={() => { const iframe = document.querySelector<HTMLIFrameElement>(".ui-preview-iframe"); if (iframe) iframe.src = devServerUrl; }}
            className="text-text-muted hover:text-text" title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            onClick={() => { import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(devServerUrl)).catch(() => {}); }}
            className="text-text-muted hover:text-text" title="Open in browser"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </>
      )}
      <button onClick={() => { setUiView("menu"); }} className="text-text-muted hover:text-text" title="Back">
        <ArrowLeft className="h-3 w-3" />
      </button>
    </div>
  );
}

/** Main UI tab content */
export function AgentUIContent({
  uiView, repoPath, devServerUrl, devServerLoading,
  setUiView, selectRepo, disconnectRepo, launchPreview, createUI,
}: ReturnType<typeof useAgentUI>) {
  // Preview
  if (uiView === "preview") {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1">
          {devServerLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <RefreshCw className="h-6 w-6 text-text-muted animate-spin mx-auto" />
                <p className="mt-3 text-xs text-text-muted">Starting dev server...</p>
                <p className="mt-1 text-[10px] text-text-muted">{repoPath?.split("/").pop()}</p>
              </div>
            </div>
          ) : devServerUrl ? (
            <iframe
              src={devServerUrl}
              className="ui-preview-iframe w-full h-full border-0 bg-white"
              title="UI Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center px-8">
                <p className="text-xs text-text-muted">No dev server detected</p>
                <p className="mt-1 text-[10px] text-text-muted">
                  Add a <code className="text-accent">dev</code> script to package.json or include an index.html
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Create
  if (uiView === "create") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-hover">
          <Plus className="h-7 w-7 text-text-muted" />
        </div>
        <div className="text-center max-w-xs">
          <h3 className="text-sm font-medium text-text">Create UI</h3>
          <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
            Choose an editor to build this agent's interface. The editor will receive full context about the agent.
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full max-w-[220px]">
          <button
            onClick={() => createUI("cursor")}
            className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
          >
            <Code className="h-3.5 w-3.5" />
            Open with Cursor
          </button>
          <button
            onClick={() => createUI("claude-code")}
            className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
          >
            <Terminal className="h-3.5 w-3.5" />
            Open with Claude Code
          </button>
        </div>
        <div className="text-center max-w-[260px] space-y-1.5">
          <p className="text-[10px] text-text-muted leading-relaxed">
            A project folder will be created with the agent's context.
            Just tell the editor "build the UI" and it will know what to do.
          </p>
          <p className="text-[10px] text-text-muted/60 leading-relaxed">
            No tokens spent on this chat — uses your editor's AI instead.
          </p>
        </div>
      </div>
    );
  }

  // Menu
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
      {repoPath ? (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-950/40 border border-blue-800/40">
            <Layout className="h-8 w-8 text-blue-400" />
          </div>
          <div className="text-center max-w-xs">
            <h3 className="text-sm font-medium text-text">{repoPath.split("/").pop()}</h3>
            <p className="mt-1 text-[10px] text-text-muted truncate max-w-[220px]">{repoPath}</p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[220px]">
            <button
              onClick={launchPreview}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Layout className="h-3.5 w-3.5" />
              Launch Preview
            </button>
            <button
              onClick={selectRepo}
              className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Change Repo
            </button>
            <button
              onClick={disconnectRepo}
              className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium text-red-400/70 hover:text-red-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-hover">
            <Layout className="h-8 w-8 text-text-muted" />
          </div>
          <div className="text-center max-w-xs">
            <h3 className="text-sm font-medium text-text">Agent UI</h3>
            <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
              Connect an existing project or create a new interface for this agent.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[220px]">
            <button
              onClick={selectRepo}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open Repo
            </button>
            <button
              onClick={() => setUiView("create")}
              className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Create
            </button>
          </div>
        </>
      )}
    </div>
  );
}
