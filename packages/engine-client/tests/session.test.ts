import { describe, it, expect, vi } from "vitest";
import { Session } from "../src/session.ts";
import type { AgentStreamDelta, AgentLifecycle, ChatEvent, SessionToolEvent } from "../src/types.ts";

function createSession(key = "main"): Session {
  const sendRpc = vi.fn().mockResolvedValue({});
  return new Session(key, sendRpc);
}

describe("Session", () => {
  describe("matchesKey", () => {
    it("matches exact key", () => {
      const s = createSession("main");
      expect(s.matchesKey("main")).toBe(true);
    });

    it("matches canonical key format", () => {
      const s = createSession("main");
      expect(s.matchesKey("agent:main:main")).toBe(true);
    });

    it("matches after canonical key is set", () => {
      const s = createSession("main");
      s.canonicalKey = "agent:main:main";
      expect(s.matchesKey("agent:main:main")).toBe(true);
    });

    it("does not match different key", () => {
      const s = createSession("main");
      expect(s.matchesKey("other")).toBe(false);
    });
  });

  describe("handleAgentEvent", () => {
    it("emits delta for assistant stream events", () => {
      const s = createSession();
      const handler = vi.fn();
      s.on("delta", handler);

      const event: AgentStreamDelta = {
        runId: "run-1",
        stream: "assistant",
        data: { text: "Hello", delta: "Hello" },
        sessionKey: "agent:main:main",
        seq: 1,
        ts: Date.now(),
      };

      s.handleAgentEvent(event);

      expect(handler).toHaveBeenCalledWith({
        text: "Hello",
        delta: "Hello",
        runId: "run-1",
      });
    });

    it("emits lifecycle events", () => {
      const s = createSession();
      const handler = vi.fn();
      s.on("lifecycle", handler);

      const event: AgentLifecycle = {
        runId: "run-1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
        sessionKey: "agent:main:main",
        seq: 1,
        ts: Date.now(),
      };

      s.handleAgentEvent(event);

      expect(handler).toHaveBeenCalledWith({ phase: "start", runId: "run-1" });
    });
  });

  describe("handleChatEvent", () => {
    it("emits response on final assistant chat event", () => {
      const s = createSession();
      const handler = vi.fn();
      s.on("response", handler);

      // First simulate a delta to accumulate text
      s.handleAgentEvent({
        runId: "run-1",
        stream: "assistant",
        data: { text: "Hello World", delta: "Hello World" },
        sessionKey: "agent:main:main",
        seq: 1,
        ts: Date.now(),
      } as AgentStreamDelta);

      // Then the final chat event
      const chatEvent: ChatEvent = {
        runId: "run-1",
        sessionKey: "agent:main:main",
        seq: 2,
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello World" }],
          timestamp: Date.now(),
        },
      };

      s.handleChatEvent(chatEvent);

      expect(handler).toHaveBeenCalledWith({ text: "Hello World", runId: "run-1" });
    });

    it("extracts text from chat event when no deltas received", () => {
      const s = createSession();
      const handler = vi.fn();
      s.on("response", handler);

      const chatEvent: ChatEvent = {
        runId: "run-1",
        sessionKey: "agent:main:main",
        seq: 1,
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Direct response" }],
          timestamp: Date.now(),
        },
      };

      s.handleChatEvent(chatEvent);

      expect(handler).toHaveBeenCalledWith({
        text: "Direct response",
        runId: "run-1",
      });
    });

    it("ignores non-final chat events", () => {
      const s = createSession();
      const handler = vi.fn();
      s.on("response", handler);

      s.handleChatEvent({
        runId: "run-1",
        sessionKey: "agent:main:main",
        seq: 1,
        state: "delta",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial" }],
          timestamp: Date.now(),
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("handleSessionTool", () => {
    it("emits toolCall events", () => {
      const s = createSession();
      const handler = vi.fn();
      s.on("toolCall", handler);

      const event: SessionToolEvent = {
        sessionKey: "agent:main:main",
        tool: { name: "exec", input: { command: "ls" } },
        status: "running",
      };

      s.handleSessionTool(event);

      expect(handler).toHaveBeenCalledWith({
        name: "exec",
        status: "running",
        input: { command: "ls" },
      });
    });
  });
});
