import { useState, useEffect } from "react";
import { ToolCallBadge } from "./chat/ToolCallBadge";
import { MessageBubble } from "./chat/MessageBubble";
import { Shimmer } from "./ai-elements/shimmer";
import { ThinkingBlock } from "./chat/ThinkingBlock";
import type { ToolCallInfo } from "@/types/chat";
import type { ChatMessage } from "@/types/chat";

const MOCK_TOOLS: ToolCallInfo[] = [
  { id: "1", name: "exec", title: "list files, `ls`", status: "running", timestamp: Date.now() },
  { id: "2", name: "read", title: "read config.json", status: "running", timestamp: Date.now(), output: "{\n  \"name\": \"my-app\",\n  \"version\": \"1.0.0\"\n}" },
  { id: "3", name: "exec", title: "install deps, `npm install`", status: "done", timestamp: Date.now(), output: "added 150 packages in 4s\n12 packages are looking for funding" },
  { id: "4", name: "edit", title: "update App.tsx", status: "done", timestamp: Date.now() },
  { id: "5", name: "search", title: "grep 'useState'", status: "error", timestamp: Date.now() },
  { id: "6", name: "web", title: "fetch api.github.com", status: "running", timestamp: Date.now() },
  { id: "7", name: "glob", title: "find **/*.tsx", status: "done", timestamp: Date.now(), output: "src/App.tsx\nsrc/main.tsx\nsrc/components/Header.tsx" },
  { id: "8", name: "write", title: "create utils.ts", status: "running", timestamp: Date.now() },
  { id: "9", name: "db", title: "query users table", status: "done", timestamp: Date.now(), output: "3 rows returned" },
  { id: "10", name: "code", title: "analyze function", status: "running", timestamp: Date.now() },
];

const MOCK_MESSAGES: ChatMessage[] = [
  { id: "u1", role: "user", content: "Can you list the files in this directory?", timestamp: Date.now() },
  { id: "a1", role: "assistant", content: "Here are the files in the current directory:\n\n- `App.tsx`\n- `index.css`\n- `main.ts`\n\nWould you like me to read any of them?", timestamp: Date.now() },
  { id: "u2", role: "user", content: "Read App.tsx", timestamp: Date.now() },
  { id: "a2", role: "assistant", content: "", timestamp: Date.now(), isStreaming: true },
];

export function DevPreview() {
  const [tools, setTools] = useState(MOCK_TOOLS);

  // Cycle a tool through states every 3s for live demo
  useEffect(() => {
    const interval = setInterval(() => {
      setTools((prev) => {
        const running = prev.filter((t) => t.status === "running");
        if (running.length === 0) return prev;
        const target = running[Math.floor(Math.random() * running.length)]!;
        return prev.map((t) =>
          t.id === target.id ? { ...t, status: "done" as const } : t,
        );
      });
    }, 3000);

    // Re-add running tools periodically
    const reset = setInterval(() => {
      setTools(MOCK_TOOLS);
    }, 12000);

    return () => { clearInterval(interval); clearInterval(reset); };
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-bg p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-lg font-semibold text-text mb-1">Component Preview</h1>
          <p className="text-xs text-text-muted">Live preview of chat components. Tools cycle through states automatically.</p>
        </div>

        {/* Shimmer */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Shimmer</h2>
          <div className="space-y-3">
            <Shimmer className="text-sm" duration={1.5}>Thinking...</Shimmer>
            <Shimmer className="text-base" duration={2}>Analyzing your code and preparing a response</Shimmer>
            <Shimmer className="text-xs" duration={1}>Loading</Shimmer>
          </div>
        </section>

        {/* Thinking Block */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Thinking Block</h2>
          <div className="space-y-3">
            <ThinkingBlock thinking="The user wants me to list files in the current directory. I should use the exec tool with the ls command to show them the directory contents. Let me also check if there are any hidden files that might be relevant." />
            <ThinkingBlock thinking="Analyzing the error... The issue is in the useEffect hook where the dependency array is missing the 'count' variable." isStreaming />
          </div>
        </section>

        {/* Tool Badges */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Tool Badges</h2>

          <div className="space-y-4">
            <div>
              <p className="text-[10px] text-text-muted mb-2">Running</p>
              <div className="flex flex-wrap gap-2">
                {tools.filter((t) => t.status === "running").map((t) => (
                  <ToolCallBadge key={t.id} tool={t} />
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-text-muted mb-2">Completed</p>
              <div className="flex flex-wrap gap-2">
                {tools.filter((t) => t.status === "done").map((t) => (
                  <ToolCallBadge key={t.id} tool={t} />
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-text-muted mb-2">Error</p>
              <div className="flex flex-wrap gap-2">
                {tools.filter((t) => t.status === "error").map((t) => (
                  <ToolCallBadge key={t.id} tool={t} />
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] text-text-muted mb-2">All (mixed)</p>
              <div className="flex flex-wrap gap-2">
                {tools.map((t) => (
                  <ToolCallBadge key={t.id} tool={t} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* In-context: how it looks in chat */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">In Chat Context</h2>
          <div className="rounded-xl border border-border overflow-hidden bg-bg">
            {/* Header mock */}
            <div className="flex h-9 items-center border-b border-border bg-bg px-3">
              <span className="text-[12px] font-medium text-text">Preview Agent</span>
            </div>

            {/* Messages */}
            <div>
              {MOCK_MESSAGES.map((msg, i) => (
                <div key={msg.id}>
                  <MessageBubble message={msg} />
                  {/* Show tools after last user message */}
                  {i === MOCK_MESSAGES.length - 2 && (
                    <div className="flex flex-wrap gap-2 px-4 py-1.5">
                      {tools.filter(t => t.status === "running").slice(0, 3).map((t) => (
                        <ToolCallBadge key={t.id} tool={t} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
