import { describe, it, expect, vi } from "vitest";
import { TypedEmitter } from "../src/emitter.ts";

type TestEvents = {
  hello: (name: string) => void;
  count: (n: number) => void;
};

class TestEmitter extends TypedEmitter<TestEvents> {
  fire<K extends keyof TestEvents>(event: K, ...args: Parameters<TestEvents[K]>): void {
    this.emit(event, ...args);
  }
}

describe("TypedEmitter", () => {
  it("calls registered listeners", () => {
    const e = new TestEmitter();
    const handler = vi.fn();
    e.on("hello", handler);
    e.fire("hello", "world");
    expect(handler).toHaveBeenCalledWith("world");
  });

  it("supports multiple listeners", () => {
    const e = new TestEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    e.on("hello", h1);
    e.on("hello", h2);
    e.fire("hello", "test");
    expect(h1).toHaveBeenCalledWith("test");
    expect(h2).toHaveBeenCalledWith("test");
  });

  it("removes listeners with off()", () => {
    const e = new TestEmitter();
    const handler = vi.fn();
    e.on("hello", handler);
    e.off("hello", handler);
    e.fire("hello", "nobody");
    expect(handler).not.toHaveBeenCalled();
  });

  it("removes all listeners for an event", () => {
    const e = new TestEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    e.on("hello", h1);
    e.on("hello", h2);
    e.removeAllListeners("hello");
    e.fire("hello", "nobody");
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it("removes all listeners when no event specified", () => {
    const e = new TestEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    e.on("hello", h1);
    e.on("count", h2);
    e.removeAllListeners();
    e.fire("hello", "nobody");
    e.fire("count", 42);
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it("swallows listener errors", () => {
    const e = new TestEmitter();
    const bad = vi.fn(() => {
      throw new Error("oops");
    });
    const good = vi.fn();
    e.on("hello", bad);
    e.on("hello", good);
    e.fire("hello", "test");
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it("does nothing when emitting with no listeners", () => {
    const e = new TestEmitter();
    expect(() => e.fire("hello", "nobody")).not.toThrow();
  });
});
