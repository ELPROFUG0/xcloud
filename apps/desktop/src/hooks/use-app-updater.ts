import { useCallback, useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "installing" | "error";

export function useAppUpdater() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    setStatus("checking");
    setError(null);
    try {
      const nextUpdate = await check({ timeout: 15000 });
      setUpdate(nextUpdate);
      setStatus(nextUpdate ? "available" : "idle");
    } catch (err) {
      setUpdate(null);
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForUpdate();
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [checkForUpdate]);

  const installUpdate = useCallback(async () => {
    if (!update) return;

    setStatus("downloading");
    setError(null);
    setDownloadProgress(0);

    let downloaded = 0;
    let contentLength = 0;

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          downloaded = 0;
          setDownloadProgress(0);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setDownloadProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
          setStatus("installing");
        }
      });
      await relaunch();
    } catch (err) {
      setStatus("available");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [update]);

  return {
    update,
    status,
    error,
    downloadProgress,
    hasUpdate: Boolean(update),
    checkForUpdate,
    installUpdate,
  };
}
