import type { BrowserEngine } from "@/lib/engine";
import { useModels } from "@/hooks/use-models";

interface GeneralSectionProps {
  engine: BrowserEngine;
  onPreviewOnboarding?: () => void;
}

export function GeneralSection({ engine, onPreviewOnboarding }: GeneralSectionProps) {
  const { currentModel } = useModels(engine);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        <h3 className="text-base font-semibold">General</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="space-y-4">
          <div className="rounded-lg bg-container p-4">
            <h4 className="text-[13px] font-medium mb-3">Gateway</h4>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">URL</span>
                <span className="font-mono text-text">ws://127.0.0.1:18789</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Status</span>
                <span className="text-emerald-400">Connected</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Model</span>
                <span className="font-mono text-text">{currentModel?.split("/").pop() ?? "none"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-container p-4">
            <h4 className="text-[13px] font-medium mb-3">About</h4>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">xCloud</span>
                <span className="text-text">v0.1.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Engine</span>
                <span className="text-text">OpenClaw (MIT)</span>
              </div>
            </div>
          </div>

          {onPreviewOnboarding && (
            <div className="rounded-lg bg-container p-4">
              <h4 className="text-[13px] font-medium mb-3">Developer</h4>
              <button
                onClick={onPreviewOnboarding}
                className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-xs text-text hover:bg-white/15 transition-colors"
              >
                Preview Onboarding
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
