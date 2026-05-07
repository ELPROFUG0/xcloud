import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import type { BrowserEngine, SlashCommand } from "@/lib/engine";
import type { AgentInfo } from "@/hooks/use-agents";
import { useModels } from "@/hooks/use-models";
import {
  ArrowUp, Mic, Paperclip, ChevronUp, Check, Plus,
  Slash, Info, Wrench, Settings, MessageSquare, LayoutGrid, Volume2, Eye, Square,
  type LucideIcon,
} from "lucide-react";
import { LiveMicrophoneWaveform } from "../ui/waveform";
import { ModelSelector, ModelSelectorTrigger } from "./ModelSelector";
import { AgentAvatar } from "../ui/AgentAvatar";
import { Shimmer } from "../ai-elements/shimmer";
import orbVideo from "@/assets/setup-icons/orb-video.mp4";

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
  variant?: "dock" | "hero";
  contextLabel?: string;
  contextEmoji?: string;
  contextAvatar?: string;
  contextIsMain?: boolean;
  agentOptions?: AgentInfo[];
  selectedAgentId?: string | null;
  onSelectAgent?: (id: string) => void;
}


export function ChatInput({
  onSend,
  disabled = false,
  placeholder,
  engine,
  variant = "dock",
  contextLabel,
  contextEmoji,
  contextAvatar,
  contextIsMain,
  agentOptions,
  selectedAgentId,
  onSelectAgent,
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
  const [modelMenuClosing, setModelMenuClosing] = useState(false);
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
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [agentMenuClosing, setAgentMenuClosing] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement>(null);

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

  const closeAgentMenu = useCallback(() => {
    if (!showAgentMenu) return;
    setAgentMenuClosing(true);
    setShowAgentMenu(false);
    window.setTimeout(() => setAgentMenuClosing(false), 140);
  }, [showAgentMenu]);

  useEffect(() => {
    if (!showAgentMenu) return;
    function handleClick(e: MouseEvent) {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) closeAgentMenu();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAgentMenu, closeAgentMenu]);

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

  const closeModelMenu = useCallback(() => {
    if (!showModels) return;
    setModelMenuClosing(true);
    setShowModels(false);
    window.setTimeout(() => setModelMenuClosing(false), 140);
  }, [showModels]);

  const openModelMenu = useCallback(() => {
    if (showAgentMenu) closeAgentMenu();
    setShowModels(true);
  }, [showAgentMenu, closeAgentMenu]);

  const openAgentMenu = useCallback(() => {
    if (!agentOptions?.length) return;
    if (showModels) closeModelMenu();
    setShowAgentMenu(true);
  }, [agentOptions?.length, showModels, closeModelMenu]);

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


  const inputPlaceholder = placeholder ?? (variant === "hero" ? "Ask Unicore anything. @ to use tools or use files" : "Message...");
  const isHero = variant === "hero";
  const hasSelectedAgent = Boolean(selectedAgentId || contextEmoji || contextAvatar || (contextLabel && contextLabel !== "Select an agent"));

  return (
    <div className={cn("relative", isHero ? "px-0 pb-0 pt-0" : "px-4 pb-4 pt-2")}>
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
        closing={modelMenuClosing}
        onClose={closeModelMenu}
        providers={providers}
        currentModel={currentModel}
        onSelectModel={async (id) => { await setModel(id); }}
        placement={isHero ? "below" : "above"}
      />

      {/* Input container */}
      <div className={cn(
        "relative z-10 border px-2.5 py-2 shadow-[0_18px_60px_rgba(0,0,0,0.26)]",
        isHero
          ? "rounded-[22px] border-white/[0.06] bg-[#252525]"
          : "rounded-2xl border-[#444] bg-container",
      )}>
        {/* Textarea — always same size */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { if (!recording) setValue(e.target.value); }}
          onKeyDown={(e) => { if (!recording) handleKeyDown(e); }}
          onInput={() => { if (!recording) handleInput(); }}
          placeholder={recording ? "Listening..." : inputPlaceholder}
          disabled={disabled || recording}
          rows={1}
          className={cn(
            "w-full resize-none bg-transparent px-1",
            isHero ? "min-h-[54px] py-2 text-[14px]" : "py-0.5 text-[13px]",
            "text-text placeholder:text-text-muted/55 leading-5",
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
                  <div className="flex items-center gap-1.5">
                    {isHero && (
                      <button
                        disabled={disabled}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/6 hover:text-text disabled:opacity-30"
                        title="Add context"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                    <div onMouseDown={(e) => e.stopPropagation()}>
                      <ModelSelectorTrigger
                        currentModel={currentModel}
                        onClick={() => {
                          if (showModels) closeModelMenu();
                          else openModelMenu();
                        }}
                        open={showModels}
                      />
                    </div>
                  </div>
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
      {isHero && (
        <div className="relative -mt-5 flex h-16 items-start gap-3 rounded-t-none rounded-b-[22px] border-x border-b border-white/[0.04] bg-[#1c1c1c] px-3 pt-7 text-[12px] text-text-muted shadow-[0_12px_36px_rgba(0,0,0,0.18)]">
          <div ref={agentMenuRef} className="relative min-w-0">
            <button
              type="button"
              onClick={() => {
                if (showAgentMenu) closeAgentMenu();
                else openAgentMenu();
              }}
              className="group flex max-w-[230px] min-w-0 items-center gap-2 rounded-full px-2 py-1 transition-colors hover:bg-white/[0.06] hover:text-text"
              title="Selected agent"
            >
              {contextAvatar ? (
                <AgentAvatar avatar={contextAvatar} isMain={contextIsMain} size="sm" className="rounded-full" />
              ) : contextEmoji ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[15px] leading-none">
                  {contextEmoji}
                </span>
              ) : hasSelectedAgent ? (
                <AgentAvatar isMain={contextIsMain} size="sm" className="rounded-full" />
              ) : (
                <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
                  <video src={orbVideo} autoPlay loop muted playsInline className="h-full w-full object-cover" />
                </span>
              )}
              {hasSelectedAgent ? (
                <span className="truncate">{contextLabel ?? "Select an agent"}</span>
              ) : (
                <Shimmer as="span" className="truncate text-[12px]" duration={1.8}>
                  {contextLabel ?? "Select an agent"}
                </Shimmer>
              )}
              <ChevronUp className="h-3 w-3 rotate-180 opacity-50 transition-opacity group-hover:opacity-90" />
            </button>

            {(showAgentMenu || agentMenuClosing) && agentOptions && agentOptions.length > 0 && (
              <div
                className={cn(
                  "absolute -left-3 top-full z-40 mt-2.5 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-2xl",
                  agentMenuClosing ? "animate-[popoverOut_140ms_ease-in_forwards]" : "animate-[slideUp_120ms_ease-out]",
                )}
              >
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {agentOptions.map((agent) => {
                    const selected = selectedAgentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          onSelectAgent?.(agent.id);
                          closeAgentMenu();
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors",
                          selected ? "bg-white/10 text-text" : "text-text-muted hover:bg-white/[0.06] hover:text-text",
                        )}
                      >
                        {agent.avatar ? (
                          <AgentAvatar avatar={agent.avatar} isMain={agent.isDefault} size="sm" className="rounded-full" />
                        ) : agent.emoji ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[15px] leading-none">
                            {agent.emoji}
                          </span>
                        ) : (
                          <AgentAvatar isMain={agent.isDefault} size="sm" className="rounded-full" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{agent.name ?? agent.id}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-text-muted" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.06] hover:text-text" title="Execution mode">
            <Wrench className="h-3.5 w-3.5" />
            <span>Work locally</span>
            <ChevronUp className="h-3 w-3 rotate-180 opacity-50 transition-opacity group-hover:opacity-90" />
          </button>
          <button className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.06] hover:text-text" title="Branch">
            <Slash className="h-3.5 w-3.5" />
            <span>main</span>
            <ChevronUp className="h-3 w-3 rotate-180 opacity-50 transition-opacity group-hover:opacity-90" />
          </button>
        </div>
      )}
    </div>
  );
}
