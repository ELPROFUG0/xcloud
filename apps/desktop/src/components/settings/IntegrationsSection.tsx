import { useState, useCallback, useEffect, useMemo } from "react";
import { Search, Plug, Loader2, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import composioAppsData from "@/data/composio-apps.json";
import type { BrowserEngine } from "@/lib/engine";
import type { ComposioApp } from "./types";

interface IntegrationsSectionProps {
  engine: BrowserEngine;
}

export function IntegrationsSection({ engine: _engine }: IntegrationsSectionProps) {
  const [composioKey, setComposioKey] = useState(() => localStorage.getItem("composioApiKey") ?? "");
  const [composioApps, setComposioApps] = useState<ComposioApp[]>([]);
  const [composioLoading, setComposioLoading] = useState(false);
  const [composioError, setComposioError] = useState<string | null>(null);
  const [composioSearch, setComposioSearch] = useState("");

  // Popular apps shown first
  const POPULAR_SLUGS = new Set([
    "gmail", "slack", "notion", "github", "googlecalendar", "googledrive",
    "googlesheets", "googledocs", "discord", "twitter", "whatsapp", "telegram",
    "linkedin", "instagram", "youtube", "jira", "linear", "trello", "asana",
    "airtable", "hubspot", "salesforce", "stripe", "shopify", "figma",
    "dropbox", "spotify", "todoist", "clickup", "intercom", "zendesk",
    "microsoft_teams", "outlook", "pipedrive", "supabase", "vercel",
    "sentry", "twilio", "mailchimp", "canva", "reddit",
  ]);

  // Full Composio app catalog loaded from JSON + logos from CDN
  const COMPOSIO_CATALOG: ComposioApp[] = useMemo(() => {
    const all = composioAppsData.map((a: { slug: string; name: string }) => ({
      slug: a.slug,
      name: a.name,
      logo: `https://logos.composio.dev/api/${a.slug}`,
      description: "",
      categories: [],
      connected: false,
    }));
    // Sort: popular first, then alphabetical
    return all.sort((a, b) => {
      const aPopular = POPULAR_SLUGS.has(a.slug);
      const bPopular = POPULAR_SLUGS.has(b.slug);
      if (aPopular && !bPopular) return -1;
      if (!aPopular && bPopular) return 1;
      return a.name.localeCompare(b.name);
    });
  }, []);

  // Show apps and check connected status when key is present
  useEffect(() => {
    if (!composioKey.trim()) {
      setComposioApps([]);
      return;
    }
    // Start with catalog
    setComposioApps(COMPOSIO_CATALOG);

    // Check connected status for popular apps via MCP
    (async () => {
      try {
        const checkSlugs = ["gmail", "slack", "notion", "github", "google_calendar", "google_drive",
          "discord", "twitter", "linkedin", "jira", "linear", "hubspot", "salesforce",
          "stripe", "shopify", "figma", "asana", "trello", "airtable", "dropbox"];

        const result = await invoke<string>("run_shell", {
          cmd: `curl -s -X POST "https://connect.composio.dev/mcp" -H "x-consumer-api-key: ${composioKey.trim()}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"COMPOSIO_MANAGE_CONNECTIONS","arguments":{"toolkits":[${checkSlugs.map(s => `{"name":"${s}","action":"list"}`).join(",")}]}}}'`,
        });

        const dataLine = result.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) return;

        const rpc = JSON.parse(dataLine.slice(5).trim());
        const contentText = rpc.result?.content?.[0]?.text ?? "";
        const inner = JSON.parse(contentText);
        const results = inner.data?.results ?? {};

        const connectedSlugs = new Set<string>();
        for (const [slug, info] of Object.entries(results)) {
          const toolkit = info as Record<string, unknown>;
          if (toolkit.status === "active") {
            connectedSlugs.add(slug);
          }
        }

        if (connectedSlugs.size > 0) {
          setComposioApps((prev) =>
            prev.map((a) => connectedSlugs.has(a.slug) ? { ...a, connected: true } : a)
          );
          // Save slugs + download logos as base64 for canvas
          const existing: Array<{slug: string; logo: string}> = JSON.parse(localStorage.getItem("composioConnected") ?? "[]");
          const existingSlugs = new Set(existing.map(e => typeof e === "string" ? e : e.slug));
          for (const slug of connectedSlugs) {
            if (!existingSlugs.has(slug)) {
              // Download logo and store as base64
              invoke<string>("run_shell", {
                cmd: `curl -s "https://logos.composio.dev/api/${slug}" | base64`,
              }).then((b64) => {
                if (!b64.trim()) return;
                const items: Array<{slug: string; logo: string}> = JSON.parse(localStorage.getItem("composioConnected") ?? "[]");
                items.push({ slug, logo: `data:image/svg+xml;base64,${b64.trim()}` });
                localStorage.setItem("composioConnected", JSON.stringify(items));
              }).catch(() => {
                // Save without logo
                const items: Array<{slug: string; logo: string}> = JSON.parse(localStorage.getItem("composioConnected") ?? "[]");
                if (!items.find(i => i.slug === slug)) {
                  items.push({ slug, logo: "" });
                  localStorage.setItem("composioConnected", JSON.stringify(items));
                }
              });
            }
          }
        }
      } catch { /* ignore — just won't show connected status */ }
    })();
  }, [composioKey, COMPOSIO_CATALOG]);

  const saveComposioKey = useCallback(async (key: string) => {
    setComposioKey(key);
    localStorage.setItem("composioApiKey", key);
    // Configure Composio MCP server in OpenClaw so agents can use connected apps
    if (key.trim()) {
      await invoke<string>("run_shell", {
        cmd: `sh -lc 'openclaw mcp set composio "{\\"transport\\":\\"streamable-http\\",\\"url\\":\\"https://connect.composio.dev/mcp\\",\\"headers\\":{\\"x-consumer-api-key\\":\\"${key.trim()}\\"}}"'`,
      }).catch(() => {});
    }
  }, []);

  const filteredComposioApps = useMemo(() => {
    if (!composioSearch.trim()) return composioApps;
    const q = composioSearch.toLowerCase();
    return composioApps.filter(a => a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q));
  }, [composioApps, composioSearch]);

  const handleComposioConnect = useCallback(async (slug: string) => {
    if (!composioKey.trim()) return;
    try {
      const result = await invoke<string>("run_shell", {
        cmd: `curl -s -X POST "https://connect.composio.dev/mcp" -H "x-consumer-api-key: ${composioKey.trim()}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"COMPOSIO_MANAGE_CONNECTIONS","arguments":{"toolkits":[{"name":"${slug}","action":"add"}]}}}'`,
      });

      const dataLine = result.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) throw new Error("No response from Composio");

      const rpcResponse = JSON.parse(dataLine.slice(5).trim());
      const contentText = rpcResponse.result?.content?.[0]?.text ?? "";
      const inner = JSON.parse(contentText);
      const redirectUrl = inner.data?.results?.[slug]?.redirect_url;

      if (redirectUrl) {
        setComposioApps((prev) =>
          prev.map((a) => a.slug === slug ? { ...a, connecting: true } : a)
        );
        await openUrl(redirectUrl);

        // Poll for connection to become active (up to 5 minutes)
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const checkResult = await invoke<string>("run_shell", {
              cmd: `curl -s -X POST "https://connect.composio.dev/mcp" -H "x-consumer-api-key: ${composioKey.trim()}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"COMPOSIO_MANAGE_CONNECTIONS","arguments":{"toolkits":[{"name":"${slug}","action":"list"}]}}}'`,
            });
            const checkLine = checkResult.split("\n").find(l => l.startsWith("data:"));
            if (checkLine) {
              const checkRpc = JSON.parse(checkLine.slice(5).trim());
              const checkText = checkRpc.result?.content?.[0]?.text ?? "";
              const checkInner = JSON.parse(checkText);
              if (checkInner.data?.results?.[slug]?.status === "active") {
                setComposioApps((prev) =>
                  prev.map((a) => a.slug === slug ? { ...a, connected: true, connecting: false } : a)
                );
                // Save with logo
                invoke<string>("run_shell", {
                  cmd: `curl -s "https://logos.composio.dev/api/${slug}" | base64`,
                }).then((b64) => {
                  const items: Array<{slug: string; logo: string}> = JSON.parse(localStorage.getItem("composioConnected") ?? "[]");
                  if (!items.find(i => i.slug === slug)) {
                    items.push({ slug, logo: b64.trim() ? `data:image/svg+xml;base64,${b64.trim()}` : "" });
                    localStorage.setItem("composioConnected", JSON.stringify(items));
                  }
                  window.dispatchEvent(new CustomEvent("xcloud-integration-changed"));
                }).catch(() => {
                  const items: Array<{slug: string; logo: string}> = JSON.parse(localStorage.getItem("composioConnected") ?? "[]");
                  if (!items.find(i => i.slug === slug)) {
                    items.push({ slug, logo: "" });
                    localStorage.setItem("composioConnected", JSON.stringify(items));
                  }
                  window.dispatchEvent(new CustomEvent("xcloud-integration-changed"));
                });
                return;
              }
            }
          } catch { /* keep polling */ }
        }
        // Timeout — remove connecting state
        setComposioApps((prev) =>
          prev.map((a) => a.slug === slug ? { ...a, connecting: false } : a)
        );
      } else {
        throw new Error("No redirect URL received");
      }
    } catch (err) {
      setComposioApps((prev) =>
        prev.map((a) => a.slug === slug ? { ...a, connecting: false } : a)
      );
      setComposioError(err instanceof Error ? err.message : "Failed to connect");
    }
  }, [composioKey]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4">
        <h3 className="text-base font-semibold text-text mb-1">Integrations</h3>
        <p className="text-xs text-text-muted mb-3">Connect apps to your agents via Composio</p>
        <div className="flex gap-2">
          <input
            type="password"
            value={composioKey}
            onChange={(e) => saveComposioKey(e.target.value)}
            placeholder="Composio API key"
            className="flex-1 rounded-xl bg-container px-4 py-2.5 text-sm text-text font-mono placeholder:text-text-muted focus:outline-none"
          />
          <a
            href="https://app.composio.dev/developers"
            target="_blank"
            rel="noreferrer"
            className="shrink-0 flex items-center rounded-xl bg-white px-4 py-2.5 text-xs text-black font-semibold hover:bg-white/90 transition-colors"
          >
            Get Key
          </a>
        </div>
        {composioKey.trim() && (
          <div className="mt-3 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={composioSearch}
              onChange={(e) => setComposioSearch(e.target.value)}
              placeholder={`Search ${filteredComposioApps.length} apps...`}
              className="w-full rounded-xl bg-container pl-8 pr-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Apps */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {!composioKey.trim() ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Plug size={32} className="text-text-muted/20 mb-3" />
            <p className="text-sm text-text-muted">Enter your API key to browse integrations</p>
            <p className="text-xs text-text-muted/50 mt-1">Free tier — 20K calls/month</p>
          </div>
        ) : composioLoading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-container animate-pulse" />
            ))}
          </div>
        ) : composioError ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-xs text-red-400">{composioError}</p>
            <button
              onClick={() => {
                setComposioApps([]);
                setComposioError(null);
                const k = composioKey;
                setComposioKey("");
                setTimeout(() => setComposioKey(k), 100);
              }}
              className="mt-2 text-xs text-text-muted hover:text-text transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredComposioApps.map((app) => (
              <div
                key={app.slug}
                className="flex items-center gap-3 rounded-xl bg-container px-3 py-3 transition-colors"
              >
                {app.logo ? (
                  <img src={app.logo} alt="" className="h-7 w-7 shrink-0 rounded-lg" />
                ) : (
                  <div className="h-7 w-7 shrink-0 rounded-lg bg-white/10 flex items-center justify-center text-xs text-text-muted">
                    {app.name[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text truncate">{app.name}</div>
                </div>
                {app.connected ? (
                  <span className="shrink-0 rounded-md px-2 py-0.5 text-[10px] text-white font-semibold" style={{ backgroundColor: "#4EDD44" }}>Connected</span>
                ) : app.connecting ? (
                  <span className="shrink-0 flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                    <Loader2 size={10} className="animate-spin" /> Waiting...
                  </span>
                ) : (
                  <button
                    onClick={() => handleComposioConnect(app.slug)}
                    className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-[10px] text-white font-medium hover:bg-white/15 transition-colors"
                  >
                    Connect
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
