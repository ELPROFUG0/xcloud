import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Layout, Code, Terminal, FolderOpen, Plus, RefreshCw, ExternalLink, ArrowLeft, X } from "lucide-react";

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

  return {
    repoPath, devServerUrl, devServerLoading, uiView,
    setUiView, selectRepo, disconnectRepo, launchPreview,
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
  uiView, repoPath, devServerUrl, devServerLoading, wsPath,
  setUiView, selectRepo, disconnectRepo, launchPreview,
}: ReturnType<typeof useAgentUI> & { wsPath: string }) {
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
    const home = "/Users/contentmanager";
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <button onClick={() => setUiView("menu")} className="absolute top-14 left-4 text-text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-hover">
          <Plus className="h-7 w-7 text-text-muted" />
        </div>
        <div className="text-center max-w-xs">
          <h3 className="text-sm font-medium text-text">Create UI</h3>
          <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
            Open the agent workspace in your editor to build its interface.
          </p>
        </div>
        <div className="flex flex-col gap-2 w-full max-w-[200px]">
          <button
            onClick={() => window.open(`cursor://file${home}/${wsPath}`, "_blank")}
            className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
          >
            <Code className="h-3.5 w-3.5" />
            Open with Cursor
          </button>
          <button
            onClick={() => {
              import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
                openUrl(`vscode://file${home}/${wsPath}`).catch(() => {});
              }).catch(() => {});
            }}
            className="flex items-center justify-center gap-2 rounded-lg bg-surface-hover px-4 py-2.5 text-xs font-medium text-text hover:bg-border transition-colors"
          >
            <Terminal className="h-3.5 w-3.5" />
            Open with Claude Code
          </button>
        </div>
        <p className="text-[10px] text-text-muted text-center leading-relaxed max-w-[240px]">
          Build the agent's UI without spending tokens.
        </p>
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
