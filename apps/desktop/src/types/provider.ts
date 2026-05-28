export interface ProviderConfig {
  id: string;
  name: string;
  envKey: string;
  placeholder: string;
}

/** Known providers and their API key environment variable names */
export const PROVIDERS: ProviderConfig[] = [
  { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY", placeholder: "sk-ant-..." },
  { id: "openai", name: "OpenAI API", envKey: "OPENAI_API_KEY", placeholder: "sk-..." },
  { id: "google", name: "Google (Gemini)", envKey: "GEMINI_API_KEY", placeholder: "AIza..." },
  { id: "google-vertex", name: "Google Vertex", envKey: "GOOGLE_APPLICATION_CREDENTIALS", placeholder: "/path/to/service-account.json" },
  { id: "mistral", name: "Mistral", envKey: "MISTRAL_API_KEY", placeholder: "..." },
  { id: "groq", name: "Groq", envKey: "GROQ_API_KEY", placeholder: "gsk_..." },
  { id: "deepseek", name: "DeepSeek", envKey: "DEEPSEEK_API_KEY", placeholder: "sk-..." },
  { id: "fireworks", name: "Fireworks", envKey: "FIREWORKS_API_KEY", placeholder: "fw_..." },
  { id: "openrouter", name: "OpenRouter", envKey: "OPENROUTER_API_KEY", placeholder: "sk-or-..." },
  { id: "xai", name: "xAI (Grok)", envKey: "XAI_API_KEY", placeholder: "xai-..." },
  { id: "cerebras", name: "Cerebras", envKey: "CEREBRAS_API_KEY", placeholder: "csk-..." },
  { id: "amazon-bedrock", name: "AWS Bedrock", envKey: "AWS_ACCESS_KEY_ID", placeholder: "AKIA..." },
  { id: "azure-openai-responses", name: "Azure OpenAI", envKey: "AZURE_OPENAI_API_KEY", placeholder: "..." },
  { id: "huggingface", name: "Hugging Face", envKey: "HF_TOKEN", placeholder: "hf_..." },
  { id: "github-copilot", name: "GitHub Copilot", envKey: "GITHUB_TOKEN", placeholder: "ghp_..." },
];
