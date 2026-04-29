# OpenClaw Security

> Fuente: https://docs.openclaw.ai/gateway/security

## Modelo de confianza

OpenClaw opera bajo un **modelo de asistente personal**: un operador de confianza por gateway (single-user). **NO** es multi-tenant adversarial.

> "Si necesitas operación multi-trust o adversarial, separa boundaries (gateway + credenciales separadas, idealmente usuarios de SO o hosts separados)."

---

## Autenticación

### Modos de auth del Gateway

| Modo | Config | Descripción |
|------|--------|-------------|
| **Token** (recomendado) | `gateway.auth.mode: "token"` | Bearer token compartido |
| **Password** | `gateway.auth.mode: "password"` | Via `OPENCLAW_GATEWAY_PASSWORD` env var |
| **Trusted proxy** | `gateway.auth.mode: "trusted-proxy"` | Para reverse proxies con identity headers |
| **None** | `gateway.auth.mode: "none"` | Sin auth (solo para loopback en test) |

### Tailscale
- `gateway.auth.allowTailscale: true` acepta headers de identidad Tailscale
- NO aplica a endpoints HTTP API (`/v1/*`, `/tools/invoke`, `/api/channels/*`)

### Device Identity & Pairing
- Control UI requiere contexto seguro (HTTPS o localhost)
- Overrides peligrosos:
  - `gateway.controlUi.allowInsecureAuth=true` — permite auth HTTP en localhost
  - `gateway.controlUi.dangerouslyDisableDeviceAuth=true` — desactiva checks de device identity

### DM Policies
| Policy | Descripción |
|--------|-------------|
| `pairing` (default) | Código de pairing de 1 hora para senders desconocidos |
| `allowlist` | Solo senders en allowlist |
| `open` | Requiere `"*"` explícito en allowlist |
| `disabled` | Ignora todos los DMs |

---

## Configuración de seguridad (baseline endurecido)

```json5
{
  gateway: {
    mode: "local",
    bind: "loopback",
    auth: { mode: "token", token: "replace-with-long-random-token" }
  },
  session: { dmScope: "per-channel-peer" },
  tools: {
    profile: "messaging",
    deny: ["group:automation", "group:runtime", "group:fs",
           "sessions_spawn", "sessions_send"],
    fs: { workspaceOnly: true },
    exec: { security: "deny", ask: "always" },
    elevated: { enabled: false }
  },
  channels: {
    whatsapp: {
      dmPolicy: "pairing",
      groups: { "*": { requireMention: true } }
    }
  }
}
```

---

## Almacenamiento de credenciales

| Credencial | Path |
|-----------|------|
| Config principal | `~/.openclaw/openclaw.json` |
| WhatsApp creds | `~/.openclaw/credentials/whatsapp/<accountId>/creds.json` |
| API keys/OAuth | `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` |
| Pairing allowlists | `~/.openclaw/credentials/<channel>-allowFrom.json` |
| Secrets opcional | `~/.openclaw/secrets.json` |

**Permisos:** directorios `700`, archivos `600`.

---

## Sandboxing

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "all",        // "all" | "non-main" | "off"
        scope: "agent",     // "agent" | "session" | "shared"
        workspaceAccess: "none"  // "none" | "ro" | "rw"
      }
    }
  }
}
```

| Modo | Descripción |
|------|-------------|
| `all` | Docker para todo |
| `non-main` | Docker solo para sesiones no-main |
| `off` | Sin sandbox, ejecución en host |

| Workspace access | Descripción |
|------------------|-------------|
| `none` | Sin acceso, tools bajo `~/.openclaw/sandboxes` |
| `ro` | Mount read-only en `/agent` |
| `rw` | Mount read/write en `/workspace` |

---

## Tool profiles

| Profile | Incluye |
|---------|---------|
| `full` | Sin restricciones |
| `coding` | fs, runtime, web, sessions, memory, cron, media |
| `messaging` | Solo messaging, sessions_list/history/send, session_status |
| `minimal` | Solo session_status |

### Allow/Deny lists
```json5
{
  tools: {
    profile: "coding",
    allow: ["group:fs", "browser", "web_search"],
    deny: ["exec"],
  }
}
```
`deny` siempre gana sobre `allow`.

---

## Prompt injection

Mitigaciones:
- DMs bloqueados (pairing/allowlists)
- Mention gating en grupos
- Links y attachments tratados como hostiles
- Sandbox para ejecución sensible
- Secretos fuera del filesystem accesible
- Limitar tools de alto riesgo (exec, browser, web_fetch, web_search)
- Usar modelos de última generación para agentes con tools

---

## Security audit

```bash
openclaw security audit          # Audit básico
openclaw security audit --deep   # Audit profundo
openclaw security audit --fix    # Audit + fix automático
openclaw security audit --json   # Output JSON
```

Cubre: permisos de filesystem, config de gateway, hooks, browser, sandbox, tools, plugins, skills.

---

## Flags peligrosos (mantener desactivados)

- `gateway.controlUi.dangerouslyDisableDeviceAuth`
- `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback`
- `hooks.gmail.allowUnsafeExternalContent`
- `tools.exec.applyPatch.workspaceOnly=false`
- `plugins.entries.acpx.config.permissionMode=approve-all`
- `channels.*.dangerouslyAllowNameMatching`
- `agents.defaults.sandbox.docker.dangerouslyAllow*`

---

## Respuesta a incidentes

1. **Contener:** parar proceso, `bind: "loopback"`, desactivar DMs/groups riesgosos
2. **Rotar:** auth de gateway, credenciales remotas, API keys de proveedores
3. **Auditar:** revisar logs (`/tmp/openclaw/openclaw-YYYY-MM-DD.log`), transcripts, re-run audit --deep
