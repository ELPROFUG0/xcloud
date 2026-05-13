import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface CanvasSearchControlProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  resultLabel?: string;
  placeholder?: string;
}

export function CanvasSearchControl({
  value,
  onChange,
  onSubmit,
  resultLabel,
  placeholder = "Search canvas",
}: CanvasSearchControlProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const close = () => {
    onChange("");
    setOpen(false);
  };

  return (
    <motion.div
      layout
      className="relative flex h-7 items-center justify-end overflow-hidden rounded-lg border border-white/[0.08] bg-[#111111] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      animate={{ width: open ? 210 : 28 }}
      transition={{ type: "spring", stiffness: 260, damping: 24, mass: 0.9 }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute left-0 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-white"
        title="Search canvas"
      >
        <Search className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="canvas-search-input"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.14 }}
            className="flex min-w-0 flex-1 items-center gap-1 pl-7 pr-1"
          >
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmit?.();
                }
              }}
              placeholder={placeholder}
              className="h-7 min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-text-muted/55"
            />
            {resultLabel && (
              <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] leading-none text-text-muted">
                {resultLabel}
              </span>
            )}
            <button
              type="button"
              onClick={close}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.08] hover:text-white"
              title="Close search"
            >
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
