import { useCallback, useEffect, useState, useRef } from "react";
import { Mic, MicOff, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { LiveWaveform } from "./LiveWaveform";

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface MicSelectorProps {
  disabled?: boolean;
  className?: string;
}

export function MicSelector({ disabled, className }: MicSelectorProps) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Load devices without permission on mount
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;
    mediaDevices.enumerateDevices().then((list) => {
      const inputs = list
        .filter(d => d.kind === "audioinput")
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label ? d.label.replace(/\s*\([^)]*\)/g, "").trim() : `Microphone ${d.deviceId.slice(0, 8)}`,
        }));
      setDevices(inputs);
      if (inputs[0] && !selectedDevice) setSelectedDevice(inputs[0].deviceId);
    }).catch(() => {});
  }, []);

  // Request permission and reload devices with labels
  const requestPermission = useCallback(async () => {
    if (hasPermission || loading) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) return;
    setLoading(true);
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setHasPermission(true);
      if (mediaDevices.enumerateDevices) {
        const list = await mediaDevices.enumerateDevices();
        const inputs = list
          .filter(d => d.kind === "audioinput")
          .map(d => ({
            deviceId: d.deviceId,
            label: d.label ? d.label.replace(/\s*\([^)]*\)/g, "").trim() : `Microphone ${d.deviceId.slice(0, 8)}`,
          }));
        setDevices(inputs);
        if (inputs[0] && !selectedDevice) setSelectedDevice(inputs[0].deviceId);
      }
    } catch {}
    setLoading(false);
  }, [hasPermission, loading, selectedDevice]);

  const handleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && !hasPermission) await requestPermission();
  };

  const isPreviewActive = open && !muted;

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Mic button */}
      <button
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-30",
          muted ? "text-text-muted hover:text-text" : "text-accent hover:text-accent-hover",
        )}
        title="Microphone"
      >
        {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out]">
          {/* Device list */}
          <div className="max-h-40 overflow-y-auto p-1">
            {loading ? (
              <div className="px-3 py-2 text-xs text-text-muted">Loading devices...</div>
            ) : devices.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-muted">No microphones found</div>
            ) : (
              devices.map((device) => (
                <button
                  key={device.deviceId}
                  onClick={() => setSelectedDevice(device.deviceId)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-hover"
                >
                  <span className="truncate text-text">{device.label}</span>
                  {selectedDevice === device.deviceId && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer: mute + waveform */}
          {devices.length > 0 && (
            <div className="flex items-center gap-2 border-t border-border px-2 py-2">
              <button
                onClick={() => setMuted(!muted)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  muted ? "text-text-muted hover:bg-surface-hover" : "text-accent hover:bg-surface-hover",
                )}
              >
                {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                <span>{muted ? "Unmute" : "Mute"}</span>
              </button>
              <div className="ml-auto w-16 overflow-hidden rounded-md bg-container p-1.5">
                <LiveWaveform
                  active={isPreviewActive}
                  deviceId={selectedDevice}
                  height={15}
                  barWidth={3}
                  barGap={1}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
