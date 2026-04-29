/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal typed event emitter */
export class TypedEmitter<Events extends Record<string, (...args: any[]) => void>> {
  private listeners = new Map<keyof Events, Set<(...args: any[]) => void>>();

  /** Register an event listener */
  on<K extends keyof Events>(event: K, listener: Events[K]): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  /** Remove an event listener */
  off<K extends keyof Events>(event: K, listener: Events[K]): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  /** Emit an event to all listeners */
  protected emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(...args);
      } catch {
        // Swallow listener errors to prevent cascading failures
      }
    }
  }

  /** Remove all listeners for an event, or all events if no event specified */
  removeAllListeners(event?: keyof Events): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}
