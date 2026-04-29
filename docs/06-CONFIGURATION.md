# OpenClaw Configuration

> Fuente: https://docs.openclaw.ai/gateway/configuration

## Archivo de configuración

- **Path default:** `~/.openclaw/openclaw.json` (JSON5)
- **Custom path:** `OPENCLAW_CONFIG_PATH` env var
- **Symlinks no soportados** para writes de OpenClaw
- Hot-reload automático (modo `hybrid` por default)

---

## Config mínima

```json5
{
  agents: { defaults: { workspace: "~/.openclaw/workspace" } },
  channels: { whatsapp: { allowFrom: ["+15555550123"] } },
}
```

---

## Métodos de edición

| Método | Comando |
|--------|---------|
| Wizard interactivo | `openclaw onboard` / `openclaw configure` |
| CLI one-liners | `openclaw config get/set/unset` |
| Control UI | http://127.0.0.1:18789 → Config tab |
| Edición directa | Editar `~/.openclaw/openclaw.json` |

---

## Validación

- Keys desconocidos, tipos malformados, valores inválidos → **startup falla**
- `$schema` es la única excepción aceptada como root key
- `openclaw config schema` → JSON Schema canónico
- `openclaw doctor` → diagnóstico
- `openclaw doctor --fix` → fix automático
- Recovery: last-known-good se restaura si validación falla

---

## Modelos

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-sonnet-4-6",
        fallbacks: ["openai/gpt-5.4"],
      },
      models: {
        "anthropic/claude-sonnet-4-6": { alias: "Sonnet" },
        "openai/gpt-5.4": { alias: "GPT" },
      },
    },
  },
}
```

- `agents.defaults.models` = catálogo + allowlist para `/model`
- Formato: `provider/model-id`

---

## Sesiones

```json5
{
  session: {
    dmScope: "per-channel-peer",  // main | per-peer | per-channel-peer | per-account-channel-peer
    threadBindings: {
      enabled: true,
      idleHours: 24,
      maxAgeHours: 0,
    },
    reset: {
      mode: "daily",
      atHour: 4,
      idleMinutes: 120,
    },
  },
}
```

---

## Multi-agent routing

```json5
{
  agents: {
    list: [
      { id: "home", default: true, workspace: "~/.openclaw/workspace-home" },
      { id: "work", workspace: "~/.openclaw/workspace-work" },
    ],
  },
  bindings: [
    { agentId: "home", match: { channel: "whatsapp", accountId: "personal" } },
    { agentId: "work", match: { channel: "whatsapp", accountId: "biz" } },
  ],
}
```

---

## Canales

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "123:abc",
      dmPolicy: "pairing",    // pairing | allowlist | open | disabled
      allowFrom: ["tg:123"],
    },
  },
}
```

---

## Sandboxing

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main",     // off | non-main | all
        scope: "agent",       // session | agent | shared
      },
    },
  },
}
```

---

## Cron

```json5
{
  cron: {
    enabled: true,
    maxConcurrentRuns: 2,
    sessionRetention: "24h",
    runLog: { maxBytes: "2mb", keepLines: 2000 },
  },
}
```

---

## Webhooks

```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
    defaultSessionKey: "hook:ingress",
    mappings: [
      {
        match: { path: "gmail" },
        action: "agent",
        agentId: "main",
        deliver: true,
      },
    ],
  },
}
```

---

## Heartbeat

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",         // duración; "0m" para desactivar
        target: "last",       // last | none | <channel-id>
      },
    },
  },
}
```

---

## Environment variables

### Carga
1. Env del proceso padre
2. `.env` del directorio actual
3. `~/.openclaw/.env` (fallback)

### Inline en config
```json5
{
  env: {
    OPENROUTER_API_KEY: "sk-or-...",
    vars: { GROQ_API_KEY: "gsk-..." },
  },
}
```

### Shell env import
```json5
{
  env: { shellEnv: { enabled: true, timeoutMs: 15000 } },
}
```

### Substitución en config
```json5
{
  gateway: { auth: { token: "${OPENCLAW_GATEWAY_TOKEN}" } },
}
```
- Solo uppercase: `[A-Z_][A-Z0-9_]*`
- Variables faltantes → error en load
- Escape: `$${VAR}` para literal

### SecretRef

```json5
{
  models: {
    providers: {
      openai: { apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" } },
    },
  },
}
```
Sources: `env`, `file`, `exec`.

---

## $include (archivos de config)

```json5
{
  gateway: { port: 18789 },
  agents: { $include: "./agents.json5" },
  broadcast: { $include: ["./clients/a.json5", "./clients/b.json5"] },
}
```

- Single file: reemplaza objeto
- Array: deep-merge en orden
- Sibling keys: merge después de includes
- Nested: hasta 10 niveles
- Paths relativos al archivo que incluye

---

## Config RPC (programático)

```bash
# Flujo preferido
openclaw gateway call config.get --params '{}'
openclaw gateway call config.patch --params '{
  "raw": "{ channels: { telegram: { groups: { \"*\": { requireMention: false } } } } }",
  "baseHash": "<hash>"
}'
```

Rate limit: 3 writes por 60s por deviceId+clientIp.

Restart: cooldown de 30s entre ciclos.
