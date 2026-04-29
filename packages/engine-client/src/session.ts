import crypto from "node:crypto";
import { TypedEmitter } from "./emitter.js";
import type {
  SessionEvents,
  AgentEvent,
  ChatEvent,
  SessionMessageEvent,
  SessionToolEvent,
  SendResult,
} from "./types.js";

type SendFn = (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Represents a chat session with an agent.
 * Emits streaming events as the agent responds.
 */
export class Session extends TypedEmitter<SessionEvents> {
  /** The canonical session key (e.g. "agent:main:main") */
  canonicalKey: string | null = null;
  private currentRunId: string | null = null;
  private accumulatedText = "";

  constructor(
    /** The session key used for requests (e.g. "main") */
    readonly key: string,
    private readonly sendRpc: SendFn,
  ) {
    super();
  }

  /** Subscribe to this session's message stream */
  async subscribe(): Promise<string> {
    const result = await this.sendRpc("sessions.messages.subscribe", { key: this.key });
    this.canonicalKey = (result as { key: string }).key;
    return this.canonicalKey;
  }

  /** Unsubscribe from this session's message stream */
  async unsubscribe(): Promise<void> {
    await this.sendRpc("sessions.messages.unsubscribe", { key: this.key });
  }

  /** Send a message to this session */
  async send(message: string): Promise<SendResult> {
    this.accumulatedText = "";
    this.currentRunId = null;

    const result = await this.sendRpc("chat.send", {
      sessionKey: this.key,
      message,
      idempotencyKey: crypto.randomUUID(),
    });

    const payload = result as { runId: string; status: string };
    this.currentRunId = payload.runId;

    return { runId: payload.runId, status: payload.status };
  }

  /** Reset session context */
  async reset(): Promise<void> {
    await this.sendRpc("sessions.reset", { key: this.key });
  }

  /** Check if a session key matches this session */
  matchesKey(sessionKey: string): boolean {
    return sessionKey === this.key ||
      sessionKey === this.canonicalKey ||
      sessionKey === `agent:main:${this.key}`;
  }

  /** Handle an incoming agent event */
  handleAgentEvent(event: AgentEvent): void {
    if (event.stream === "assistant") {
      const delta = event as { data: { text: string; delta: string }; runId: string };
      this.accumulatedText = delta.data.text;
      this.emit("delta", {
        text: delta.data.text,
        delta: delta.data.delta,
        runId: event.runId,
      });
    }

    if (event.stream === "lifecycle") {
      const lc = event as { data: { phase: "start" | "end" }; runId: string };
      this.emit("lifecycle", { phase: lc.data.phase, runId: event.runId });
    }
  }

  /** Handle an incoming chat event */
  handleChatEvent(event: ChatEvent): void {
    if (event.state === "final" && event.message?.role === "assistant") {
      // Extract final text
      let text = this.accumulatedText;
      if (!text && event.message.content) {
        const blocks = Array.isArray(event.message.content)
          ? event.message.content
          : [{ type: "text" as const, text: event.message.content }];
        text = blocks
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text)
          .join("");
      }

      this.emit("response", { text, runId: event.runId });
      this.accumulatedText = "";
    }
  }

  /** Handle a session message event */
  handleSessionMessage(event: SessionMessageEvent): void {
    this.emit("message", event);
  }

  /** Handle a session tool event */
  handleSessionTool(event: SessionToolEvent): void {
    this.emit("toolCall", {
      name: event.tool?.name ?? "unknown",
      status: event.status ?? "unknown",
      input: event.tool?.input,
    });
  }
}
