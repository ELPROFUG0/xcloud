import { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { BrowserEngine } from "@/lib/engine";
import type { SkillInfo } from "./types";

let skillsCache: SkillInfo[] = [];

interface SkillsSectionProps {
  engine: BrowserEngine;
}

function extractJsonObject(output: string) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return "{}";
  return output.slice(start, end + 1);
}

function parseSkillsList(jsonOutput: string) {
  const json = JSON.parse(extractJsonObject(jsonOutput));
  const list = Array.isArray(json.skills) ? json.skills : [];
  return list.map((skill: Record<string, unknown>) => ({
    name: typeof skill.name === "string" ? skill.name : "",
    description: typeof skill.description === "string" ? skill.description.slice(0, 120) : "",
    emoji: typeof skill.emoji === "string" ? skill.emoji : "",
    author: typeof skill.author === "string" ? skill.author : "",
    version: typeof skill.version === "string" ? skill.version : "",
    installed: skill.eligible === true,
  })).filter((skill: SkillInfo) => skill.name);
}

export function SkillsSection({ engine: _engine }: SkillsSectionProps) {
  const [skills, setSkills] = useState<SkillInfo[]>(skillsCache);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsFilter, setSkillsFilter] = useState<"all" | "ready" | "setup">("all");

  useEffect(() => {
    if (skillsCache.length > 0) { setSkills(skillsCache); return; }
    setSkillsLoading(true);

    invoke<string>("xcloud_run", { args: ["skills", "list", "--json"] }).then((jsonOutput) => {
      const parsed = parseSkillsList(jsonOutput);
      skillsCache = parsed;
      setSkills(parsed);
      setSkillsLoading(false);
    }).catch(() => {
      setSkillsLoading(false);
    });
  }, []);

  const readyCount = skills.filter(s => s.installed).length;
  const setupCount = skills.filter(s => !s.installed).length;
  const filtered = skillsFilter === "all" ? skills : skillsFilter === "ready" ? skills.filter(s => s.installed) : skills.filter(s => !s.installed);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        <h3 className="text-base font-semibold">Skills</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div>
          {/* Filter tabs */}
          <div className="flex gap-1 mb-3 items-center">
            {([
              { id: "all" as const, label: `All`, count: skills.length },
              { id: "ready" as const, label: `Ready`, count: readyCount },
              { id: "setup" as const, label: `Needs setup`, count: setupCount },
            ]).map((f) => (
              <button
                key={f.id}
                onClick={() => setSkillsFilter(f.id)}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${skillsFilter === f.id ? "bg-white text-black" : "bg-container text-text-muted hover:text-text"}`}
              >
                {f.label} <span className={skillsFilter === f.id ? "text-black/50" : "text-text-muted/40"}>{f.count}</span>
              </button>
            ))}
          </div>

          <div className="space-y-1">
            {skillsLoading ? (
              <div className="py-8 text-center text-xs text-text-muted">Loading skills...</div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center">
                <Sparkles className="h-8 w-8 text-text-muted/30 mx-auto mb-3" />
                <p className="text-xs text-text-muted">No skills found</p>
              </div>
            ) : (
              filtered.map((skill) => (
                <div
                  key={skill.name}
                  className="rounded-lg bg-container px-4 py-3 transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-lg">
                      {skill.emoji || "\u26A1"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">{skill.name}</span>
                        {skill.version && <span className="text-[9px] text-text-muted/40">{skill.version}</span>}
                      </div>
                      <p className="text-[11px] text-text-muted leading-tight mt-0.5 truncate">{skill.description}</p>
                    </div>
                    <div className={`h-2 w-2 shrink-0 rounded-full ${skill.installed ? "bg-emerald-400" : "bg-amber-400"}`} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
