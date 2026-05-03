import { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Code, Terminal, FolderOpen, Plus, RefreshCw, ExternalLink, ArrowLeft, X, ChevronDown } from "lucide-react";
import xcloudLogo from "@/assets/xcloud-logo.svg?url";

import cursorLogo from "@/assets/editors/cursor.svg";
import vscodeLogo from "@/assets/editors/vscode.svg";
import windsurfLogo from "@/assets/editors/windsurf.svg";
import claudeCodeLogo from "@/assets/editors/claude-code.svg";
import itermLogo from "@/assets/editors/iterm.png";
import zedLogo from "@/assets/editors/zed.svg";
import terminalLogo from "@/assets/editors/terminal.svg";
import codexLogo from "@/assets/editors/codex.svg";
import opencodeLogo from "@/assets/editors/opencode.svg";
import antigravityLogo from "@/assets/editors/antigravity.png";

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
- The UI will be previewed inside xCloud (a Tauri desktop app)
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
  const [hasProject, setHasProject] = useState(false);

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
          // Check if project has package.json with dev script
          const pkgCheck = await invoke<string>("run_shell", { cmd: `grep -q '"dev"' "${config.repoPath}/package.json" 2>/dev/null && echo "yes" || echo "no"` }).catch(() => "no");
          setHasProject(pkgCheck.trim() === "yes");
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
  const createUI = useCallback(async (editor: string) => {
    const uiPath = await scaffoldUI(_agentId, wsPath, home);
    setRepoPath(uiPath);
    await saveConfig(uiPath);

    const cmds: Record<string, string> = {
      cursor: `open -a "Cursor" "${uiPath}" || cursor "${uiPath}"`,
      vscode: `open -a "Visual Studio Code" "${uiPath}" || code "${uiPath}"`,
      windsurf: `open -a "Windsurf" "${uiPath}" || windsurf "${uiPath}"`,
      zed: `open -a "Zed" "${uiPath}" || zed "${uiPath}"`,
      codex: `open -a "Codex" "${uiPath}" || codex "${uiPath}"`,
      antigravity: `open -a "Antigravity" "${uiPath}" || antigravity "${uiPath}"`,
      "claude-code": `echo '#!/bin/bash\\ncd "${uiPath}"\\nclaude' > /tmp/open-claude.sh && chmod +x /tmp/open-claude.sh && open -a Terminal /tmp/open-claude.sh`,
      opencode: `echo '#!/bin/bash\\ncd "${uiPath}"\\nopencode' > /tmp/open-opencode.sh && chmod +x /tmp/open-opencode.sh && open -a Terminal /tmp/open-opencode.sh`,
      iterm: `osascript -e 'tell application "iTerm" to create window with default profile command "cd \\"${uiPath}\\""'`,
      terminal: `open -a Terminal "${uiPath}"`,
    };

    const cmd = cmds[editor];
    if (cmd) await invoke("run_shell", { cmd }).catch(() => {});
  }, [_agentId, wsPath, home, saveConfig]);

  return {
    repoPath, devServerUrl, devServerLoading, uiView, hasProject,
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

/** Dropdown button for IDE/Terminal selection */
function CreateDropdown({ label, options, onSelect }: {
  label: string;
  options: Array<{ id: string; name: string; logo: string; isPng?: boolean }>;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-medium text-text hover:bg-white/15 transition-colors"
      >
        {label}
        <ChevronDown className={`h-3 w-3 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out] p-1">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { onSelect(opt.id); setOpen(false); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-text transition-colors hover:bg-white/6"
            >
              <img src={opt.logo} alt={opt.name} className={`${opt.isPng ? "h-5 w-5" : "h-4 w-4"} object-contain`} />
              {opt.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Main UI tab content */
export function AgentUIContent({
  uiView, repoPath, devServerUrl, devServerLoading, hasProject,
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
                <button
                  onClick={disconnectRepo}
                  className="mt-4 text-[11px] text-red-400/70 hover:text-red-400 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Create
  if (uiView === "create") {
    const editors = [
      { logo: codexLogo, name: "Codex", rotate: -18 },
      { logo: cursorLogo, name: "Cursor", rotate: -12 },
      { logo: vscodeLogo, name: "VS Code", rotate: -6 },
      { logo: windsurfLogo, name: "Windsurf", rotate: 0 },
      { logo: zedLogo, name: "Zed", rotate: 6 },
      { logo: opencodeLogo, name: "OpenCode", rotate: 12, smallPad: true },
      { logo: antigravityLogo, name: "Antigravity", rotate: -15, noPad: true },
      { logo: claudeCodeLogo, name: "Claude Code", rotate: 18 },
      { logo: itermLogo, name: "iTerm", rotate: 8, noPad: true },
    ];

    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        {/* Stacked editor logos */}
        <div className="flex items-center justify-center h-20">
          <div className="flex items-center -space-x-3">
            {editors.map((e, i) => (
              <div
                key={e.name}
                className={`h-12 w-12 rounded-xl bg-surface-hover shadow-lg border border-white/10 transition-transform hover:scale-110 hover:z-10 ${(e as any).noPad ? "p-0 overflow-hidden" : (e as any).smallPad ? "p-0.5" : "p-1.5"}`}
                style={{ transform: `rotate(${e.rotate}deg)`, zIndex: i }}
              >
                <img src={e.logo} alt={e.name} className="h-full w-full object-contain" />
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-text-muted">Pick an editor — it will get full agent context.</p>
        <div className="flex flex-col gap-2 w-full max-w-[240px]">
          <CreateDropdown
            label="Open with IDE"
            options={[
              { id: "cursor", name: "Cursor", logo: cursorLogo },
              { id: "vscode", name: "VS Code", logo: vscodeLogo },
              { id: "windsurf", name: "Windsurf", logo: windsurfLogo },
              { id: "zed", name: "Zed", logo: zedLogo },
              { id: "codex", name: "Codex", logo: codexLogo },
              { id: "antigravity", name: "Antigravity", logo: antigravityLogo, isPng: true },
            ]}
            onSelect={createUI}
          />
          <CreateDropdown
            label="Open with Terminal"
            options={[
              { id: "claude-code", name: "Claude Code", logo: claudeCodeLogo },
              { id: "opencode", name: "OpenCode", logo: opencodeLogo },
              { id: "iterm", name: "iTerm", logo: itermLogo, isPng: true },
              { id: "terminal", name: "Terminal", logo: terminalLogo },
            ]}
            onSelect={createUI}
          />
          <button
            onClick={() => setUiView("menu")}
            className="mt-1 text-[11px] text-text-muted/50 hover:text-text-muted transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // Menu
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
      {repoPath ? (
        <>
          <div
              className="h-16 w-16"
              style={{
                WebkitMaskImage: `url("${xcloudLogo}")`,
                maskImage: `url("${xcloudLogo}")`,
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                backgroundImage: "linear-gradient(90deg, #777 0%, #777 35%, #bbb 50%, #777 65%, #777 100%)",
                backgroundSize: "250% 100%",
                animation: "shimmerBg 2.7s linear infinite",
              }}
            />
          <div className="text-center max-w-xs">
            <h3 className="text-sm font-medium text-text">{repoPath.split("/").pop()}</h3>
            <p className="mt-1 text-[10px] text-text-muted truncate max-w-[220px]">{repoPath}</p>
            {!hasProject && (
              <p className="mt-1.5 text-[10px] text-amber-400/70">Waiting for project to be built...</p>
            )}
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[220px]">
            {hasProject ? (
              <button
                onClick={launchPreview}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-medium text-black hover:bg-white/90 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Launch Preview
              </button>
            ) : (
              <>
                <button
                  onClick={() => invoke("run_shell", { cmd: `open -a "Cursor" "${repoPath}"` }).catch(() => {})}
                  className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-medium text-text hover:bg-white/15 transition-colors"
                >
                  <Code className="h-3.5 w-3.5" />
                  Continue in Cursor
                </button>
                <button
                  onClick={() => invoke("run_shell", { cmd: `osascript -e 'tell application "Terminal" to do script "cd \\"${repoPath}\\" && claude"'` }).catch(() => {})}
                  className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-medium text-text hover:bg-white/15 transition-colors"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Continue in Claude Code
                </button>
              </>
            )}
            <button
              onClick={selectRepo}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-medium text-text hover:bg-white/15 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Change Repo
            </button>
            <button
              onClick={disconnectRepo}
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-red-400/70 hover:text-red-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <div
              className="h-16 w-16"
              style={{
                WebkitMaskImage: `url("${xcloudLogo}")`,
                maskImage: `url("${xcloudLogo}")`,
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                backgroundImage: "linear-gradient(90deg, #777 0%, #777 35%, #bbb 50%, #777 65%, #777 100%)",
                backgroundSize: "250% 100%",
                animation: "shimmerBg 2.7s linear infinite",
              }}
            />
          <div className="text-center max-w-xs">
            <h3 className="text-sm font-medium text-text">Agent UI</h3>
            <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
              Connect an existing project or create a new interface for this agent.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[220px]">
            <button
              onClick={selectRepo}
              className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-medium text-black hover:bg-white/90 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open Repo
            </button>
            <button
              onClick={() => setUiView("create")}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-medium text-text hover:bg-white/15 transition-colors"
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
