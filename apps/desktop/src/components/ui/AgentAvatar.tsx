import { useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

interface AgentAvatarProps {
  emoji?: string;
  avatar?: string;
  isMain?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: { container: "h-5 w-5", icon: "h-2.5 w-2.5", emoji: "text-[10px]", img: "h-5 w-5" },
  md: { container: "h-6 w-6", icon: "h-3 w-3", emoji: "text-xs", img: "h-6 w-6" },
  lg: { container: "h-12 w-12", icon: "h-6 w-6", emoji: "text-2xl", img: "h-12 w-12" },
};

export function AgentAvatar({ emoji, avatar, isMain, size = "md", className }: AgentAvatarProps) {
  const s = SIZES[size];
  const [imgError, setImgError] = useState(false);

  if (avatar && avatar.length > 0 && !imgError) {
    return (
      <img
        src={avatar}
        alt=""
        onError={() => setImgError(true)}
        className={cn(s.img, "shrink-0 rounded-lg object-cover", className)}
      />
    );
  }

  return (
    <div className={cn(
      s.container, "shrink-0 flex items-center justify-center rounded-lg",
      "bg-[#262626] text-text",
      className,
    )}>
      {emoji ? (
        <span className={s.emoji}>{emoji}</span>
      ) : isMain ? (
        <Sparkles className={s.icon} />
      ) : (
        <Bot className={s.icon} />
      )}
    </div>
  );
}
