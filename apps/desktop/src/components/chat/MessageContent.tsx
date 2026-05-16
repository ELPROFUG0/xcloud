import { memo, useCallback, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BundledLanguage } from "shiki";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "../ai/code-block";
import { stripHiddenUiActionDirectives } from "./chat-message-utils";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted/70 transition-colors hover:text-text hover:bg-white/8"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 15C9 12.1716 9 10.7574 9.87868 9.87868C10.7574 9 12.1716 9 15 9L16 9C18.8284 9 20.2426 9 21.1213 9.87868C22 10.7574 22 12.1716 22 15V16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H15C12.1716 22 10.7574 22 9.87868 21.1213C9 20.2426 9 18.8284 9 16L9 15Z" />
          <path d="M16.9999 9C16.9975 6.04291 16.9528 4.51121 16.092 3.46243C15.9258 3.25989 15.7401 3.07418 15.5376 2.90796C14.4312 2 12.7875 2 9.5 2C6.21252 2 4.56878 2 3.46243 2.90796C3.25989 3.07417 3.07418 3.25989 2.90796 3.46243C2 4.56878 2 6.21252 2 9.5C2 12.7875 2 14.4312 2.90796 15.5376C3.07417 15.7401 3.25989 15.9258 3.46243 16.092C4.51121 16.9528 6.04291 16.9975 9 16.9999" />
        </svg>
      )}
    </button>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const markdownComponents: any = {
  a({ href, children }: { href?: string; children?: ReactNode }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          if (href) {
            import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href));
          }
        }}
        className="text-accent underline underline-offset-2 hover:text-accent-hover cursor-pointer"
      >
        {children}
      </a>
    );
  },
  pre({ children }: { children: ReactNode }) {
    return <>{children}</>;
  },
  code({ className, children }: { className?: string; children?: ReactNode }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const codeStr = String(children).replace(/\n$/, "");
    if (match) {
      return (
        <CodeBlock code={codeStr} language={match[1] as BundledLanguage}>
          <CodeBlockHeader>
            <CodeBlockTitle>
              <CodeBlockFilename>{match[1]}</CodeBlockFilename>
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
        </CodeBlock>
      );
    }
    return <code className={className}>{children}</code>;
  },
};

export const MessageBubbleContent = memo(function MessageBubbleContent({ content }: { content: string }) {
  const visibleContent = stripHiddenUiActionDirectives(content);
  if (!visibleContent) return null;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {visibleContent}
    </ReactMarkdown>
  );
});
