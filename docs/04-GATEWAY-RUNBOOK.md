# OpenClaw Gateway Runbook

> Fuente: https://docs.openclaw.ai/gateway

## Quick start (5 minutos)

```bash
# Iniciar gateway
openclaw gateway --port 18789
openclaw gateway --port 18789 --verbose   # con debug
openclaw gateway --force                   # forzar si puerto ocupado

# Verificar salud
openclaw gateway status
openclaw status
openclaw logs --follow

# Validar canales
openclaw channels status --probe
```

**Healthy baseline:** `Runtime: running`, `Connectivity probe: ok`.

---

## Runtime model

- Proceso único siempre encendido
- Puerto multiplexado (default 18789): WebSocket RPC + HTTP APIs + Control UI + Hooks
- Bind: `loopback` por default
- Auth requerida por default

### Precedencia de puerto

| Setting | Orden |
|---------|-------|
| `--port` | 1 (máxima) |
| `OPENCLAW_GATEWAY_PORT` | 2 |
| `gateway.port` en config | 3 |
| `18789` | 4 (default) |

### Precedencia de bind

| Setting | Orden |
|---------|-------|
| CLI/override | 1 |
| `gateway.bind` | 2 |
| `loopback` | 3 (default) |

---

## Endpoints OpenAI-compatible

| Endpoint | Uso |
|----------|-----|
| `GET /v1/models` | Catálogo de modelos |
| `GET /v1/models/{id}` | Modelo específico |
| `POST /v1/embeddings` | Embeddings |
| `POST /v1/chat/completions` | Chat completions |
| `POST /v1/responses` | Responses API |

Modelos devueltos: `openclaw`, `openclaw/default`, `openclaw/<agentId>`.

---

## Hot reload

| Modo | Comportamiento |
|------|----------------|
| `hybrid` (default) | Hot-apply seguro, restart automático si necesario |
| `hot` | Solo hot-apply, log warning si requiere restart |
| `restart` | Restart en cualquier cambio |
| `off` | Sin watching; cambios al siguiente restart manual |

### Qué se puede hot-reload

| Categoría | Restart? |
|-----------|----------|
| Channels, agent, models, routing | No |
| Hooks, cron, heartbeat | No |
| Session, messages, tools, browser, skills | No |
| UI, logging, identity, bindings | No |
| **Gateway server** (port, bind, auth, TLS) | **Sí** |
| **Discovery, canvasHost, plugins** | **Sí** |

---

## Supervisión de servicio

### macOS (launchd)
```bash
openclaw gateway install
openclaw gateway status
openclaw gateway restart
openclaw gateway stop
```
Label: `ai.openclaw.gateway` (o `ai.openclaw.<profile>` con named profile).

### Linux (systemd user)
```bash
openclaw gateway install
systemctl --user enable --now openclaw-gateway.service
sudo loginctl enable-linger <user>   # persistir después de logout
```

### Windows
```powershell
openclaw gateway install
openclaw gateway status --json
openclaw gateway restart
```
Scheduled Task: "OpenClaw Gateway".

---

## Múltiples gateways (mismo host)

Normalmente solo uno. Si necesitas múltiples:

```bash
# Gateway A
OPENCLAW_CONFIG_PATH=~/.openclaw/a.json OPENCLAW_STATE_DIR=~/.openclaw-a openclaw gateway --port 19001

# Gateway B
OPENCLAW_CONFIG_PATH=~/.openclaw/b.json OPENCLAW_STATE_DIR=~/.openclaw-b openclaw gateway --port 19002
```

Checklist por instancia:
- Puerto único
- `OPENCLAW_CONFIG_PATH` único
- `OPENCLAW_STATE_DIR` único
- `agents.defaults.workspace` único

---

## Acceso remoto

**Preferido:** Tailscale/VPN

**Fallback:** SSH tunnel
```bash
ssh -N -L 18789:127.0.0.1:18789 user@host
```

---

## Dev profile

```bash
openclaw --dev setup
openclaw --dev gateway --allow-unconfigured
openclaw --dev status
```
Puerto base: `19001`, state/config aislado.

---

## Comandos operativos

```bash
openclaw gateway status            # Estado
openclaw gateway status --deep     # Con scan de servicios
openclaw gateway status --json     # Output JSON
openclaw gateway install           # Instalar servicio
openclaw gateway restart           # Reiniciar
openclaw gateway stop              # Parar
openclaw secrets reload            # Recargar secretos
openclaw logs --follow             # Logs en vivo
openclaw doctor                    # Diagnóstico
openclaw doctor --fix              # Diagnóstico + fix
```

---

## Errores comunes

| Error | Causa probable |
|-------|---------------|
| "refusing to bind gateway ... without auth" | Bind no-loopback sin auth |
| "another gateway instance is already listening" / `EADDRINUSE` | Puerto en conflicto |
| "Gateway start blocked: set gateway.mode=local" | Config en modo remote |
| "unauthorized" during connect | Auth mismatch |

---

## Protocolo (resumen operativo)

- Primer frame del cliente debe ser `connect`
- Gateway devuelve `hello-ok` con snapshot: presence, health, stateVersion, uptimeMs, limits/policy
- Agent runs son two-stage: ack inmediato (`accepted`) + respuesta final (`ok`/`error`) con streaming en medio
