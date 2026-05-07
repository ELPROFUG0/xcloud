import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/cn";
import type { BrowserEngine, SlashCommand } from "@/lib/engine";
import type { AgentInfo } from "@/hooks/use-agents";
import { useModels } from "@/hooks/use-models";
import {
  ArrowUp, Mic, ChevronUp, Check, Plus,
  Slash, Info, Wrench, Settings, MessageSquare, LayoutGrid, Volume2, Eye, Square,
  type LucideIcon,
} from "lucide-react";
import { LiveMicrophoneWaveform } from "../ui/waveform";
import { ModelSelector, ModelSelectorTrigger } from "./ModelSelector";
import { AgentAvatar } from "../ui/AgentAvatar";
import { Shimmer } from "../ai-elements/shimmer";
import orbVideo from "@/assets/setup-icons/orb-video.mp4";

interface TranscriptionResult {
  text: string;
  confidence: number;
  duration: number;
  processingTime: number;
  rtfx: number;
}

interface AudioStatus {
  ready: boolean;
  modelDownloaded: boolean;
  modelPath: string;
}

const AUDIO_MIME_CANDIDATES = [
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm",
];

function getRecordingFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  return AUDIO_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

function extensionFromMime(mime: string) {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("aac")) return "aac";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("webm")) return "webm";
  return "m4a";
}

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
  const [transcribing, setTranscribing] = useState(false);
  const [preparingSpeech, setPreparingSpeech] = useState(false);
  const [speechModelDownloaded, setSpeechModelDownloaded] = useState<boolean | null>(null);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [micDevices, setMicDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedMic, setSelectedMic] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const micMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { providers, currentModel, setModel } = useModels(engine, { agentId: selectedAgentId, agents: agentOptions });
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

  useEffect(() => {
    invoke<AudioStatus>("local_speech_status")
      .then((status) => {
        setSpeechModelDownloaded(status.modelDownloaded);
      })
      .catch(() => setSpeechModelDownloaded(null));
  }, []);

  const appendTranscription = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setValue((current) => {
      const next = current.trim() ? `${current.trimEnd()} ${trimmed}` : trimmed;
      return next;
    });
    setPendingResize(true);
    textareaRef.current?.focus();
  }, []);

  const cleanupRecording = useCallback(() => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setRecording(false);
  }, []);

  const transcribeRecording = useCallback(async (blob: Blob) => {
    setTranscribing(true);
    try {
      const buffer = await blob.arrayBuffer();
      const result = await invoke<TranscriptionResult>("transcribe_audio_background", {
        bytes: Array.from(new Uint8Array(buffer)),
        extension: extensionFromMime(blob.type),
      });
      appendTranscription(result.text);
    } catch (error) {
      console.error("Local transcription failed", error);
    } finally {
      setTranscribing(false);
    }
  }, [appendTranscription]);

  // Request mic permission and record audio locally for transcription.
  const startRecording = useCallback(async () => {
    if (recording || transcribing || preparingSpeech) return;
    try {
      if (typeof MediaRecorder === "undefined") {
        throw new Error("MediaRecorder is not available in this WebView");
      }

      const status = await invoke<AudioStatus>("local_speech_status").catch(() => null);
      setSpeechModelDownloaded(status?.modelDownloaded ?? null);

      if (!status?.ready) {
        setPreparingSpeech(true);
        const prepared = await invoke<AudioStatus>("prepare_local_speech");
        setSpeechModelDownloaded(prepared.modelDownloaded);
        setPreparingSpeech(false);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: selectedMic ? { deviceId: { exact: selectedMic } } : true });
      recordingStreamRef.current = stream;

      // Reload devices with labels
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter(d => d.kind === "audioinput").map(d => ({
        deviceId: d.deviceId,
        label: d.label ? d.label.replace(/\s*\([^)]*\)/g, "").trim() : `Mic ${d.deviceId.slice(0, 8)}`,
      }));
      setMicDevices(inputs);
      if (inputs[0] && !selectedMic) setSelectedMic(inputs[0].deviceId);

      const format = getRecordingFormat();
      const recorder = format ? new MediaRecorder(stream, { mimeType: format }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || format || "audio/mp4";
        const blob = new Blob(audioChunksRef.current, { type });
        cleanupRecording();
        if (blob.size > 0) void transcribeRecording(blob);
      };
      recorder.onerror = () => cleanupRecording();
      recorder.start();
      setRecording(true);
    } catch (error) {
      console.error("Microphone recording failed", error);
      setPreparingSpeech(false);
      cleanupRecording();
    }
  }, [cleanupRecording, preparingSpeech, recording, selectedMic, transcribeRecording, transcribing]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanupRecording();
      return;
    }

    recorder.stop();
  }, [cleanupRecording]);

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
  const speechStatusText = preparingSpeech
    ? speechModelDownloaded === false
      ? "Downloading local speech model..."
      : "Preparing local speech..."
    : transcribing
      ? "Transcribing locally..."
      : recording
        ? "Listening..."
        : "";

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
          onChange={(e) => { if (!recording && !transcribing && !preparingSpeech) setValue(e.target.value); }}
          onKeyDown={(e) => { if (!recording && !transcribing && !preparingSpeech) handleKeyDown(e); }}
          onInput={() => { if (!recording && !transcribing && !preparingSpeech) handleInput(); }}
          placeholder={recording || transcribing || preparingSpeech ? "" : inputPlaceholder}
          disabled={disabled || recording || transcribing || preparingSpeech}
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

        {(recording || transcribing || preparingSpeech) && (
          <div className={cn(
            "pointer-events-none absolute left-3 right-3 top-2 z-20",
            isHero ? "pt-2" : "pt-0.5",
          )}>
            <div className="flex items-center gap-2">
              <Shimmer as="span" className={cn("truncate font-medium", isHero ? "text-[14px]" : "text-[13px]")} duration={1.4}>
                {speechStatusText}
              </Shimmer>
              {preparingSpeech && (
                <span className="shrink-0 text-[10px] text-text-muted/45">
                  first setup
                </span>
              )}
            </div>
            {preparingSpeech && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full w-1/3 rounded-full bg-white/70 shadow-[0_0_12px_rgba(255,255,255,0.35)] animate-[speechProgress_1.1s_ease-in-out_infinite]" />
              </div>
            )}
          </div>
        )}

        {/* Bottom bar */}
        <div className="relative mt-1.5 flex h-8 items-center justify-between">
          {/* Waveform — absolute behind buttons, only when recording */}
          {(recording || transcribing || preparingSpeech) && (
            <div className="absolute inset-0 z-0">
              <LiveMicrophoneWaveform
                active={recording}
                height={28}
                barWidth={5}
                barHeight={3}
                barGap={3}
                barRadius={3}
                barColor="rgba(170, 170, 170, 0.7)"
                sensitivity={1.2}
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
            {recording || transcribing || preparingSpeech ? (
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
            {recording || transcribing || preparingSpeech ? (
              <button
                onClick={stopRecording}
                disabled={transcribing || preparingSpeech}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full transition-all",
                  preparingSpeech || transcribing ? "bg-white/[0.08] text-text-muted" : "bg-red-500 text-white hover:bg-red-600",
                )}
                title={preparingSpeech ? "Preparing local speech..." : transcribing ? "Transcribing..." : "Stop recording"}
              >
                {transcribing || preparingSpeech ? (
                  <Shimmer as="span" className="text-[10px]" duration={1.4}>
                    {preparingSpeech ? "..." : "..."}
                  </Shimmer>
                ) : (
                  <Square className="h-2.5 w-2.5 fill-current" />
                )}
              </button>
            ) : (
              <>
                <div className="relative flex items-center">
                  <button
                    onClick={startRecording}
                    disabled={disabled || preparingSpeech}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text disabled:opacity-30"
                    title="Voice"
                  >
                    <Mic className="h-4 w-4" />
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

                <button
                  onClick={handleSend}
                  disabled={disabled || !hasText}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-text-muted/45"
                  title="Send"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
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
        </div>
      )}
    </div>
  );
}
