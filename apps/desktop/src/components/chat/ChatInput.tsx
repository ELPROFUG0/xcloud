import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import type { BrowserEngine, SlashCommand } from "@/lib/engine";
import { useModels } from "@/hooks/use-models";
import {
  ArrowUp, Mic, Paperclip, ChevronUp, Check,
  Slash, Info, Wrench, Settings, MessageSquare, LayoutGrid, Volume2, Eye, Square,
  type LucideIcon,
} from "lucide-react";
import { LiveMicrophoneWaveform } from "../ui/waveform";
import { ModelSelector, ModelSelectorTrigger } from "./ModelSelector";

const COMMAND_ICONS: Record<string, LucideIcon> = {
  status: Info,
  tools: Wrench,
  management: Settings,
  session: MessageSquare,
  options: LayoutGrid,
  media: Volume2,
  undefined: Eye,
};

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  engine: BrowserEngine;
}


export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Message...",
  engine,
}: ChatInputProps) {
  const [value, setValue] = useState("");

  // Listen for prefill prompt from setup guide
  const [pendingResize, setPendingResize] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent).detail as string;
      if (prompt) {
        setValue(prompt);
        setPendingResize(true);
      }
    };
    window.addEventListener("xcloud-prefill-prompt", handler);
    return () => window.removeEventListener("xcloud-prefill-prompt", handler);
  }, []);
  // Resize after React renders the new value
  useEffect(() => {
    if (!pendingResize) return;
    setPendingResize(false);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 80) + "px";
      el.style.overflowY = el.scrollHeight > 80 ? "auto" : "hidden";
    }
  }, [pendingResize]);

  const [showModels, setShowModels] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [micDevices, setMicDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedMic, setSelectedMic] = useState("");
  const micMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { providers, currentModel, setModel } = useModels(engine);
  const hasText = value.trim().length > 0;
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [showSlash, setShowSlash] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashRef = useRef<HTMLDivElement>(null);

  // Load mic devices
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((list) => {
      const inputs = list.filter(d => d.kind === "audioinput").map(d => ({
        deviceId: d.deviceId,
        label: d.label ? d.label.replace(/\s*\([^)]*\)/g, "").trim() : `Mic ${d.deviceId.slice(0, 8)}`,
      }));
      setMicDevices(inputs);
      if (inputs[0] && !selectedMic) setSelectedMic(inputs[0].deviceId);
    }).catch(() => {});
  }, []);

  // Close mic menu on click outside
  useEffect(() => {
    if (!showMicMenu) return;
    function handleClick(e: MouseEvent) {
      if (micMenuRef.current && !micMenuRef.current.contains(e.target as Node)) setShowMicMenu(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMicMenu]);

  // Request mic permission when starting recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: selectedMic ? { deviceId: { exact: selectedMic } } : true });
      stream.getTracks().forEach(t => t.stop()); // just for permission
      // Reload devices with labels
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter(d => d.kind === "audioinput").map(d => ({
        deviceId: d.deviceId,
        label: d.label ? d.label.replace(/\s*\([^)]*\)/g, "").trim() : `Mic ${d.deviceId.slice(0, 8)}`,
      }));
      setMicDevices(inputs);
      if (inputs[0] && !selectedMic) setSelectedMic(inputs[0].deviceId);
    } catch {}
    setRecording(true);
  }, [selectedMic]);

  const stopRecording = useCallback(() => {
    setRecording(false);
  }, []);

  // Load commands once
  useEffect(() => {
    engine.listCommands().then(setCommands).catch(() => {});
  }, [engine]);

  // Show/hide slash menu based on input
  const slashQuery = value.startsWith("/") ? value.slice(1).toLowerCase() : null;
  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return [];
    return commands.filter(c =>
      c.name.toLowerCase().includes(slashQuery) ||
      c.description.toLowerCase().includes(slashQuery)
    );
  }, [commands, slashQuery]);

  useEffect(() => {
    setShowSlash(slashQuery !== null && filteredCommands.length > 0);
    setSlashIndex(0);
  }, [slashQuery, filteredCommands.length]);


  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlash && filteredCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashIndex(i => Math.min(i + 1, filteredCommands.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIndex(i => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          const cmd = filteredCommands[slashIndex];
          if (cmd) {
            setValue("/" + cmd.name + (cmd.acceptsArgs ? " " : ""));
            setShowSlash(false);
            if (!cmd.acceptsArgs) handleSend();
          }
          return;
        }
        if (e.key === "Escape") {
          setShowSlash(false);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showSlash, filteredCommands, slashIndex],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // 4 lines max (~80px), then scroll
    const lineHeight = 20;
    const maxHeight = lineHeight * 4;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);


  return (
    <div className="relative px-4 pb-4 pt-2">
      {/* Slash commands menu */}
      {showSlash && (
        <div
          ref={slashRef}
          className="absolute bottom-full left-6 right-6 mb-2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out]"
        >
          <div className="max-h-[40vh] overflow-y-auto overflow-x-hidden p-1">
            {filteredCommands.map((cmd, i) => {
              const Icon = COMMAND_ICONS[cmd.category] ?? Slash;
              return (
                <button
                  key={cmd.name}
                  onClick={() => {
                    setValue("/" + cmd.name + (cmd.acceptsArgs ? " " : ""));
                    setShowSlash(false);
                    textareaRef.current?.focus();
                    if (!cmd.acceptsArgs) handleSend();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    i === slashIndex ? "bg-surface-hover" : "hover:bg-surface-hover/50",
                  )}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-container">
                    <Icon className="h-3 w-3 text-text-muted" />
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="text-[12px] font-medium text-text">/{cmd.name}</div>
                    <div className="truncate text-[10px] text-text-muted">{cmd.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Model selector */}
      <ModelSelector
        open={showModels}
        onClose={() => setShowModels(false)}
        providers={providers}
        currentModel={currentModel}
        onSelectModel={async (id) => { await setModel(id); }}
      />

      {/* Input container */}
      <div className="rounded-2xl bg-container border border-[#444] px-2.5 py-2">
        {/* Textarea — always same size */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { if (!recording) setValue(e.target.value); }}
          onKeyDown={(e) => { if (!recording) handleKeyDown(e); }}
          onInput={() => { if (!recording) handleInput(); }}
          placeholder={recording ? "Listening..." : placeholder}
          disabled={disabled || recording}
          rows={1}
          className={cn(
            "w-full resize-none bg-transparent px-1 py-0.5",
            "text-[13px] text-text placeholder:text-text-muted leading-5",
            "focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          style={{ overflowY: "hidden" }}
        />

        {/* Bottom bar */}
        <div className="relative flex items-center justify-between mt-1.5" style={{ height: 28 }}>
          {/* Waveform — absolute behind buttons, only when recording */}
          {recording && (
            <div className="absolute inset-0 z-0">
              <LiveMicrophoneWaveform
                active={recording}
                height={28}
                barWidth={5}
                barHeight={3}
                barGap={3}
                barRadius={3}
                barColor="rgba(170, 170, 170, 0.7)"
                sensitivity={3.5}
                fadeEdges={true}
                fadeWidth={60}
                fftSize={128}
                smoothingTimeConstant={0.5}
                updateRate={80}
                enableAudioPlayback={false}
              />
            </div>
          )}

          {/* Left side */}
          <div className="relative z-10">
            {recording ? (
              <div />
            ) : (
              <ModelSelectorTrigger
                currentModel={currentModel}
                onClick={() => setShowModels(!showModels)}
                open={showModels}
              />
            )}
          </div>

          {/* Right side */}
          <div className="relative z-10 flex items-center gap-1">
            {recording ? (
              <button
                onClick={stopRecording}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white transition-all hover:bg-red-600"
                title="Stop recording"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
              </button>
            ) : (
              <>
                <button
                  disabled={disabled}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text disabled:opacity-30"
                  title="Attach"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </button>

                {hasText ? (
                  <button
                    onClick={handleSend}
                    disabled={disabled}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white transition-all hover:bg-accent-hover disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                ) : (
                  <div className="relative flex items-center gap-0">
                    <button
                      onClick={startRecording}
                      disabled={disabled}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text disabled:opacity-30"
                      title="Voice"
                    >
                      <Mic className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setShowMicMenu(!showMicMenu)}
                      disabled={disabled}
                      className="flex h-5 w-4 items-center justify-center text-text-muted/50 hover:text-text-muted transition-colors disabled:opacity-30"
                      title="Select microphone"
                    >
                      <ChevronUp className="h-2.5 w-2.5" />
                    </button>

                    {showMicMenu && (
                      <div
                        ref={micMenuRef}
                        className="absolute bottom-full right-0 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-[slideUp_120ms_ease-out]"
                      >
                        <div className="max-h-40 overflow-y-auto p-1">
                          {micDevices.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-text-muted">No microphones found</div>
                          ) : (
                            micDevices.map((device) => (
                              <button
                                key={device.deviceId}
                                onClick={() => { setSelectedMic(device.deviceId); setShowMicMenu(false); }}
                                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-hover"
                              >
                                <span className="truncate text-text">{device.label}</span>
                                {selectedMic === device.deviceId && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
