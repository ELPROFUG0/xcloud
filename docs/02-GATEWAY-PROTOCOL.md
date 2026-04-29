# OpenClaw Gateway Protocol (WebSocket RPC)

> Fuente: https://docs.openclaw.ai/gateway/protocol

El protocolo WebSocket es el control plane unificado de OpenClaw. Todos los clientes (CLI, web UI, apps, nodes) se conectan por WebSocket y declaran su rol y scope durante el handshake.

---

## Transporte

- **WebSocket** con frames de texto JSON
- TLS soportado con pinning opcional de certificado (`gateway.tls`)
- Primer frame **debe** ser un `connect` request
- Pre-connect: frames capped a 64 KiB
- Post-handshake: según `hello-ok.policy.maxPayload` (~25 MB) y `maxBufferedBytes` (~50 MB)

---

## Handshake (3 fases)

### Fase 1: Connect Challenge (server → client)

```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": { "nonce": "…", "ts": 1737264000000 }
}
```

### Fase 2: Connect Request (client → server)

```json
{
  "type": "req",
  "id": "unique-id",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "cli",
      "version": "1.2.3",
      "platform": "macos",
      "mode": "operator"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "auth": { "token": "…" },
    "device": {
      "id": "device_fingerprint",
      "publicKey": "…",
      "signature": "…",
      "signedAt": 1737264000000,
      "nonce": "…"
    }
  }
}
```

**Nota para Agent Studio:** Para conexión local simplificada, se puede omitir `device` si se usa token auth directo en loopback. Verificar si `gateway.controlUi.dangerouslyDisableDeviceAuth` o `allowInsecureAuth` permiten saltarse el device signing en localhost.

### Fase 3: Hello-OK (server → client)

```json
{
  "type": "res",
  "id": "…",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": { "version": "…", "connId": "…" },
    "features": { "methods": ["…"], "events": ["…"] },
    "snapshot": { "…": "…" },
    "auth": {
      "role": "operator",
      "scopes": ["operator.read", "operator.write"],
      "deviceToken": "…"
    },
    "policy": {
      "maxPayload": 26214400,
      "maxBufferedBytes": 52428800,
      "tickIntervalMs": 15000
    }
  }
}
```

### Startup: UNAVAILABLE

Durante startup, `connect` puede devolver error `UNAVAILABLE` con `details.reason: "startup-sidecars"` y `retryAfterMs`. Reintentar, no tratar como error fatal.

---

## Tipos de frames

### Request (client → server)
```json
{ "type": "req", "id": "unique-id", "method": "method.name", "params": { ... } }
```
- `id` único por request
- Métodos con side-effects requieren idempotency keys

### Response (server → client)
```json
{ "type": "res", "id": "unique-id", "ok": true, "payload": { ... } }
// o en error:
{ "type": "res", "id": "unique-id", "ok": false, "error": { ... } }
```

### Event (server push)
```json
{ "type": "event", "event": "event.name", "payload": { ... }, "seq": 42, "stateVersion": 7 }
```
- Cada conexión tiene su propio `seq` monotónico
- `stateVersion` para tracking de estado

---

## Eventos principales

### Sistema y lifecycle
| Evento | Descripción |
|--------|-------------|
| `connect.challenge` | Nonce de pre-auth |
| `tick` | Keepalive periódico (default 30s pre-handshake, configurable post) |
| `heartbeat` | Updates de heartbeat stream |
| `health` | Cambios en health snapshot |
| `shutdown` | Gateway cerrándose |
| `presence` | Modificaciones de presencia |

### Session y chat
| Evento | Descripción |
|--------|-------------|
| `session.message` | **Streaming de respuesta del agente** (transcript) |
| `session.tool` | **Tool calls** en ejecución |
| `sessions.changed` | Cambios en índice/metadata de sesiones |
| `chat` | Updates de chat UI |

### Node
| Evento | Descripción |
|--------|-------------|
| `node.pair.requested/resolved` | Lifecycle de pairing |
| `node.invoke.request` | Comando de invoke broadcast |
| `node.presence.alive` | Background alive de nodes pareados |

### Approval
| Evento | Descripción |
|--------|-------------|
| `exec.approval.requested/resolved` | Lifecycle de aprobación de ejecución |
| `plugin.approval.requested/resolved` | Lifecycle de aprobación de plugins |

### Cron
| Evento | Descripción |
|--------|-------------|
| `cron` | Eventos de cron run/job |

### Scope-gating de eventos
- Chat/agent/tool: requieren `operator.read`
- Plugin broadcasts: requieren `operator.write` o `operator.admin`
- Status/transport (heartbeat, presence, tick): sin restricción

---

## Métodos RPC principales

### Mensajería
| Método | Descripción |
|--------|-------------|
| `sessions.send` | Enviar mensaje a sesión existente |
| `sessions.steer` | Interrumpir y redirigir sesión activa |
| `sessions.abort` | Abortar trabajo activo |
| `chat.send` | Enviar a chat |
| `chat.inject` | Inyectar mensaje en chat |
| `send` | Envío directo outbound (channel/account/thread) |

### Sesiones
| Método | Descripción |
|--------|-------------|
| `sessions.create` | Crear sesión nueva |
| `sessions.list` | Listar sesiones |
| `sessions.get` | Sesión completa |
| `sessions.resolve` | Resolver/canonicalizar target |
| `sessions.patch` | Actualizar metadata/overrides |
| `sessions.reset` | Resetear sesión |
| `sessions.delete` | Eliminar sesión |
| `sessions.compact` | Compactar transcript |

### Suscripciones (clave para streaming)
| Método | Descripción |
|--------|-------------|
| `sessions.subscribe` | Recibir cambios en índice de sesiones |
| `sessions.unsubscribe` | Dejar de recibir cambios |
| `sessions.messages.subscribe` | **Recibir streaming de mensajes de una sesión** |
| `sessions.messages.unsubscribe` | Dejar de recibir streaming |

### Chat history
| Método | Descripción |
|--------|-------------|
| `chat.history` | Transcripts normalizados (strips directives, control tokens, tool-call XML) |

### Agentes
| Método | Descripción |
|--------|-------------|
| `agents.list` | Agentes configurados con metadata de modelo |
| `agents.create` | Crear agente |
| `agents.update` | Actualizar agente |
| `agents.delete` | Eliminar agente |
| `agents.files.*` | Gestión de archivos de workspace |

### Tools
| Método | Descripción |
|--------|-------------|
| `tools.catalog` | Catálogo completo de tools con provenance |
| `tools.effective` | Tools efectivos por sesión |

### Config
| Método | Descripción |
|--------|-------------|
| `config.get` | Snapshot actual + hash |
| `config.patch` | Updates parciales (JSON merge patch) |
| `config.apply` | Reemplazo completo de config |
| `config.schema.lookup` | Schema por path |

### Skills
| Método | Descripción |
|--------|-------------|
| `skills.*` | Lifecycle de skills y descubrimiento en ClawHub |

### Cron
| Método | Descripción |
|--------|-------------|
| `cron.list` | Listar jobs |
| `cron.add` | Agregar job |
| `cron.update` | Actualizar job |
| `cron.remove` | Eliminar job |
| `cron.status` | Estado de cron |

---

## Agent runs (two-stage)

1. Ack inmediato: `status: "accepted"`
2. Respuesta final: `status: "ok" | "error"`, con eventos `agent` streameados en medio

---

## Flujo de enviar mensaje y recibir streaming

```
1. Client → sessions.messages.subscribe { sessionKey: "main" }
2. Client → sessions.send { sessionKey: "main", message: "hola" }
3. Server → session.message (streaming, múltiples eventos)
4. Server → session.tool (si hay tool calls)
5. Server → session.message (respuesta final)
```

### Deduplicación
Cache corto por channel/account/peer/session/message-id.

### Debouncing
Mensajes rápidos consecutivos se agrupan en un solo turno del agente (default 2000ms). Media/attachments flush inmediato.

---

## Streaming layers

### Block streaming (canales)
Emite bloques completados. Chunker con `minChars`/`maxChars`, respeta code fences.

### Preview streaming
Mensaje temporal durante generación. Modos: `off`, `partial`, `block`, `progress`.

---

## Roles y scopes

### Roles
- **operator**: control plane (CLI/UI/automation)
- **node**: capability host (camera/screen/canvas/system.run)

### Operator scopes
| Scope | Descripción |
|-------|-------------|
| `operator.read` | Lectura de estado |
| `operator.write` | Mutaciones |
| `operator.admin` | Administración |
| `operator.approvals` | Decisiones de aprobación |
| `operator.pairing` | Gestión de pairing |
| `operator.talk.secrets` | Config sensible de TTS/Talk |

### Node capabilities
- `caps`: categorías (camera, canvas, screen, location, voice)
- `commands`: allowlist de comandos
- `permissions`: toggles granulares

---

## Timeouts y reconexión

| Parámetro | Valor |
|-----------|-------|
| Protocol version | 3 |
| RPC timeout | 30,000 ms |
| Connect challenge timeout | 15,000 ms |
| Initial backoff | 1,000 ms |
| Max backoff | 30,000 ms |
| Fast retry (device close) | 250 ms |
| Force stop grace | 250 ms |
| Default tick interval | 30,000 ms |
| Tick timeout close | Code 4000 after tickIntervalMs × 2 |
| Max payload | ~25 MB |

### Reconexión
- Usar device token guardado para reconectar
- Prioridad: explicit token > explicit deviceToken > stored per-device token > bootstrapToken
- Auto-promote solo en endpoints trusted (loopback o wss:// con TLS pinning)

---

## Errores de device auth

| Error | Código | Fix |
|-------|--------|-----|
| nonce required | `DEVICE_AUTH_NONCE_REQUIRED` | Incluir `device.nonce` |
| nonce mismatch | `DEVICE_AUTH_NONCE_MISMATCH` | Firmar con nonce actual |
| signature invalid | `DEVICE_AUTH_SIGNATURE_INVALID` | Verificar payload v2/v3 |
| signature expired | `DEVICE_AUTH_SIGNATURE_EXPIRED` | Verificar timestamp skew |
| device id mismatch | `DEVICE_AUTH_DEVICE_ID_MISMATCH` | Verificar fingerprint |
| public key invalid | `DEVICE_AUTH_PUBLIC_KEY_INVALID` | Validar formato de key |
