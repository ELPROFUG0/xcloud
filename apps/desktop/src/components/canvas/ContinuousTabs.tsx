import { LayoutGroup, motion } from "framer-motion";

interface ContinuousTabItem<T extends string> {
  id: T;
  label: string;
}

interface ContinuousTabsProps<T extends string> {
  groupId: string;
  tabs: ContinuousTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
}

export function ContinuousTabs<T extends string>({
  groupId,
  tabs,
  activeId,
  onChange,
}: ContinuousTabsProps<T>) {
  return (
    <LayoutGroup id={groupId}>
      <nav className="relative flex items-center gap-0.5 rounded-xl border border-white/[0.08] bg-[#111111] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {tabs.map((tab) => {
          const isActive = activeId === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className="relative min-w-14 rounded-lg px-3 py-1 text-[10px] font-medium outline-none transition-colors"
            >
              {isActive && (
                <motion.div
                  layoutId="active-tab-pill"
                  className="absolute inset-0 rounded-lg bg-[#242424] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.85 }}
                />
              )}
              <motion.span
                layout="position"
                className={`relative z-10 transition-colors duration-150 ${
                  isActive ? "text-white" : "text-text-muted hover:text-text"
                }`}
              >
                {tab.label}
              </motion.span>
            </button>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
