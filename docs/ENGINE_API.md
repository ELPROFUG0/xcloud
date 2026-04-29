# ENGINE API — OpenClaw Gateway WebSocket Protocol

> Documentación viva del protocolo real observado conectándose al Gateway v2026.4.26.
> Puerto default: 18789. Protocolo: WebSocket JSON text frames.

---

## 1. Handshake

### Paso 1: Connect Challenge (server → client)

El servidor envía un challenge inmediatamente al abrir el WebSocket:

```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": {
    "nonce": "504c5a0a-768c-42a2-b4b0-0e2471354f29",
    "ts": 1777487087576
  }
}
```

### Paso 2: Connect Request (client → server)

El cliente **debe** responder con un `connect` como primer frame. Requiere:
- Auth token del gateway
- Device identity con firma ed25519 del nonce

```json
{
  "type": "req",
  "id": "connect-1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "cli",
      "version": "0.1.0",
      "platform": "macos",
      "mode": "cli"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "auth": {
      "token": "<gateway_auth_token>"
    },
    "device": {
      "id": "<device_id>",
      "publicKey": "<base64url_ed25519_public_key>",
      "signature": "<base64url_signature>",
      "signedAt": 1777487087600,
      "nonce": "<nonce_from_challenge>"
    }
  }
}
```

#### Valores permitidos de `client`

| Campo | Valores válidos observados |
|-------|--------------------------|
| `id` | `"cli"` (otros: `"web"`, etc.) |
| `mode` | `"cli"` |
| `platform` | `"macos"`, `"linux"`, `"windows"`, `"web"` |

#### Device Identity — Cómo firmar

1. **Generar keypair ed25519** (o cargar de `~/.openclaw/identity/device.json`)
2. **Device ID** = SHA256 hex de los 32 bytes raw de la public key
3. **Public key** = base64url de los 32 bytes raw
4. **Payload v2** (funciona):
   ```
   v2|<deviceId>|<clientId>|<clientMode>|<role>|<scopes_csv>|<signedAtMs>|<authToken>|<nonce>
   ```
   Ejemplo: `v2|6222c1...|cli|cli|operator|operator.read,operator.write|1777487087600|173010...|504c5a0a-...`
5. **Signature** = base64url de `crypto.sign(null, Buffer.from(payload), privateKey)`

#### Identidad persistida

OpenClaw guarda la identidad del device en `~/.openclaw/identity/device.json`:

```json
{
  "version": 1,
  "deviceId": "6222c118...",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "createdAtMs": 1777485787932
}
```

Para desarrollo, reusar esta identidad evita necesitar pairing approval.

### Paso 3: Hello-OK (server → client)

```json
{
  "type": "res",
  "id": "connect-1",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": { "version": "2026.4.26", "connId": "..." },
    "features": {
      "methods": ["health", "sessions.list", "chat.send", "..."],
      "events": ["session.message", "agent", "chat", "..."]
    },
    "auth": {
      "role": "operator",
      "scopes": ["operator.read", "operator.write"],
      "deviceToken": "..."
    },
    "policy": {
      "maxPayload": 26214400,
      "maxBufferedBytes": 52428800,
      "tickIntervalMs": 15000
    }
  }
}
```

**Importante:** Si `scopes` es `[]`, no tienes permisos. Necesitas device signing correcto.

---

## 2. Tipos de frames

| Tipo | Dirección | Formato |
|------|-----------|---------|
| `req` | client → server | `{ type: "req", id, method, params }` |
| `res` | server → client | `{ type: "res", id, ok, payload/error }` |
| `event` | server push | `{ type: "event", event, payload, seq? }` |

---

## 3. Suscribirse a eventos de sesión

```json
{
  "type": "req",
  "id": "sub-1",
  "method": "sessions.messages.subscribe",
  "params": { "key": "main" }
}
```

**Nota:** El parámetro es `key`, NO `sessionKey`.

Respuesta:
```json
{ "type": "res", "id": "sub-1", "ok": true, "payload": { "subscribed": true, "key": "agent:main:main" } }
```

La session key canónica es `agent:main:main` (formato `agent:<agentId>:<sessionName>`).

---

## 4. Enviar un mensaje

```json
{
  "type": "req",
  "id": "send-1",
  "method": "chat.send",
  "params": {
    "sessionKey": "main",
    "message": "Hello!",
    "idempotencyKey": "<uuid>"
  }
}
```

**Campos requeridos:** `sessionKey`, `message`, `idempotencyKey`.

Respuesta inmediata (ack):
```json
{ "type": "res", "id": "send-1", "ok": true, "payload": { "runId": "...", "status": "started" } }
```

**No hay segundo `res` de completion.** La finalización se detecta por eventos.

---

## 5. Eventos de streaming (respuesta del agente)

### 5.1 `agent` — Streaming delta (principal para streaming en vivo)

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "...",
    "stream": "assistant",
    "data": {
      "text": "Hello Agent Studio!\n\nAh, so that's who I am.",
      "delta": "Hello Agent Studio!\n\nAh, so that's who I am."
    },
    "sessionKey": "agent:main:main",
    "seq": 2,
    "ts": 1777487092590
  }
}
```

- `data.delta` = texto incremental nuevo
- `data.text` = texto acumulado hasta ahora
- `stream: "assistant"` = respuesta del modelo
- `stream: "lifecycle"` = eventos de ciclo de vida

### 5.2 `agent` — Lifecycle (inicio/fin)

Inicio:
```json
{ "event": "agent", "payload": { "stream": "lifecycle", "data": { "phase": "start", "startedAt": ... } } }
```

**Fin (usar para detectar que el agente terminó):**
```json
{ "event": "agent", "payload": { "stream": "lifecycle", "data": { "phase": "end", "livenessState": "working", "endedAt": ... } } }
```

### 5.3 `chat` — Mensaje compuesto

```json
{
  "event": "chat",
  "payload": {
    "runId": "...",
    "sessionKey": "agent:main:main",
    "seq": 2,
    "state": "delta",
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "Hello Agent Studio!" }],
      "timestamp": 1777487109004
    }
  }
}
```

- `state: "delta"` = actualización parcial
- `state: "final"` = mensaje completo terminado

### 5.4 `session.message` — Transcript completo

Incluye `thinking` blocks del modelo:
```json
{
  "event": "session.message",
  "payload": {
    "sessionKey": "agent:main:main",
    "message": {
      "role": "assistant",
      "content": [
        { "type": "thinking", "thinking": "The user is asking me to..." },
        { "type": "text", "text": "Hello Agent Studio" }
      ]
    }
  }
}
```

---

## 6. Tool calls (observados en la documentación)

### Evento `session.tool`
```json
{
  "event": "session.tool",
  "payload": {
    "sessionKey": "...",
    "tool": { "name": "exec", "input": { "command": "ls -la" } },
    "status": "running"
  }
}
```

### En evento `agent` (stream: "tool")
```json
{
  "event": "agent",
  "payload": {
    "stream": "tool",
    "data": { "name": "exec", "input": {...}, "result": {...} }
  }
}
```

---

## 7. Eventos de sistema

| Evento | Frecuencia | Payload |
|--------|-----------|---------|
| `tick` | Cada ~15s (post-handshake) | `{ ts }` |
| `health` | Periódico | `{ ok, ts, plugins: { loaded: [...] } }` |
| `sessions.changed` | Cuando cambian sesiones | Metadata de sesiones |
| `presence` | Cambios de presencia | Devices/connections |

---

## 8. Otros métodos RPC útiles

| Método | Params | Descripción |
|--------|--------|-------------|
| `sessions.list` | `{}` | Listar sesiones activas |
| `agents.list` | `{}` | Listar agentes configurados |
| `tools.catalog` | `{}` | Catálogo de tools disponibles |
| `config.get` | `{}` | Config actual + hash |
| `config.patch` | `{ raw, baseHash }` | Actualizar config |
| `cron.list` | `{}` | Listar cron jobs |
| `cron.add` | `{ ... }` | Agregar cron job |

---

## 9. Constantes

| Parámetro | Valor |
|-----------|-------|
| Protocol version | 3 |
| Default port | 18789 |
| RPC timeout | 30,000 ms |
| Tick interval (post-handshake) | 15,000 ms |
| Max payload | ~25 MB |
| Config file | `~/.openclaw/openclaw.json` |
| Identity file | `~/.openclaw/identity/device.json` |
| Auth token location | `gateway.auth.token` en config |

---

## 10. Flujo completo resumido

```
1. WS open → server envía connect.challenge
2. Client firma nonce con ed25519 y envía connect request
3. Server responde hello-ok con scopes
4. Client llama sessions.messages.subscribe { key: "main" }
5. Client llama chat.send { sessionKey, message, idempotencyKey }
6. Server responde { status: "started" }
7. Server envía eventos "agent" con stream: "assistant" (deltas incrementales)
8. Server envía evento "agent" con stream: "lifecycle", phase: "end"
9. Server envía evento "chat" con state: "final"
```
