export type Section = "models" | "keys" | "channels" | "skills" | "integrations" | "memory" | "engine" | "appearance" | "general";
export type EngineMode = "local" | "mac-mini" | "vps";

export interface SkillInfo {
  name: string;
  description: string;
  emoji?: string;
  author?: string;
  version?: string;
  installed?: boolean;
}

export interface KeyState {
  value: string;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

export interface ComposioApp {
  slug: string;
  name: string;
  logo: string;
  description: string;
  categories: string[];
  connected: boolean;
  connecting?: boolean;
}

export interface ChannelField {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "select" | "number" | "toggle";
  options?: string[];
  description?: string;
}

export interface ChannelConfig {
  id: string;
  name: string;
  logo: string;
  fields: ChannelField[];
  advancedFields?: ChannelField[];
  description: string;
}
