export type CanvasSurfaceTab = "canvas" | "ui";

const TAB_PREFIX = "xcloud.canvasSurface.tab.";
const PANEL_OPEN_PREFIX = "xcloud.canvasSurface.panelOpen.";

function storageKey(prefix: string, surfaceId: string) {
  return `${prefix}${encodeURIComponent(surfaceId)}`;
}

function readLocalStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures; preferences should never block the app.
  }
}

export function getCanvasSurfaceTab(surfaceId: string): CanvasSurfaceTab {
  const value = readLocalStorage(storageKey(TAB_PREFIX, surfaceId));
  return value === "ui" ? "ui" : "canvas";
}

export function setCanvasSurfaceTab(surfaceId: string, tab: CanvasSurfaceTab) {
  writeLocalStorage(storageKey(TAB_PREFIX, surfaceId), tab);
}

export function getCanvasPanelOpen(surfaceId: string) {
  return readLocalStorage(storageKey(PANEL_OPEN_PREFIX, surfaceId)) !== "false";
}

export function setCanvasPanelOpen(surfaceId: string, open: boolean) {
  writeLocalStorage(storageKey(PANEL_OPEN_PREFIX, surfaceId), String(open));
}
