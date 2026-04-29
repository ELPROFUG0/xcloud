# PROJECT BRIEF — Agent Studio (codename)

> Documento maestro para Claude Code. Léelo completo antes de ejecutar cualquier paso.
> Cada fase tiene **criterios de éxito** explícitos. No avances de fase hasta cumplirlos.

---

## 1. Visión

Construir un **IDE de agentes de IA para usuarios técnicos y semi-técnicos** (indie hackers, devs, power users, automation nerds). El producto permite:

- Construir agentes funcionales conversando con un meta-agente
- Verlos visualmente como un canvas estilo n8n / Obsidian (triggers, tools, conexiones)
- Conversar con cada agente individualmente (cada agente tiene su propio chat)
- Correrlos 24/7 en infraestructura del usuario (laptop local, Mac Mini, o VPS gestionado)
- Controlarlos remotamente desde una mobile app companion (V2, no V1)

**Mental model para venta:** *"Es Cursor, pero para agentes en lugar de código. Construyes agentes hablando, los ves visualmente, corren 24/7 en tu Mac Mini o VPS, los controlas desde el cel."*

---

## 2. Decisiones arquitectónicas tomadas

Estas decisiones ya están cerradas. **No las re-debatas, ejecuta sobre ellas.**

| Decisión | Elección | Razón |
|---|---|---|
| Motor de runtime de agentes | **OpenClaw** (https://docs.openclaw.ai) | Open source MIT, local-first, multi-channel, sandboxing, multi-agent routing nativos |
| Forma de integración con OpenClaw | **Sidecar binario embebido** (NO fork) | Evita deuda técnica de mantener fork; permite actualizaciones limpias |
| Framework desktop | **Tauri 2.0** | Bundle pequeño, baja memoria, evita problemas de node_modules de Electron |
| Frontend | **React + Vite + TypeScript** | Stack maduro, componentes ricos disponibles |
| UI Components | **shadcn/ui + Tailwind** | Velocidad y consistencia |
| Canvas visual (panel derecho) | **React Flow** + dagre/elk auto-layout | Maduro, evita construir canvas desde cero |
| Modelo de LLM | **BYOK** — usuario trae su propia API key | No absorbemos costos de tokens |
| Modelo de runtime de agentes | **Three-tier**: local (gratis), Mac Mini bridge (sub baja), VPS gestionado (sub alta) | Onboarding sin fricción + upgrade path natural |
| Aislamiento de seguridad | **Un Gateway de OpenClaw por usuario, NUNCA compartido** | OpenClaw NO es multi-tenant adversarial por diseño |
| Branding | **Rebrand silencioso completo** | Usuario nunca ve "OpenClaw"; sí incluir acknowledgments en menú "About" |

---

## 3. Arquitectura del producto

### 3.1 Componentes top-level

```
┌─────────────────────────────────────────────────────────────┐
│  DESKTOP APP (Tauri + React) — el "IDE de agentes"          │
│  ├─ Panel izquierdo: lista de chats por agente              │
│  ├─ Panel central: chat activo (orquestador o agente)       │
│  └─ Panel derecho: canvas visual del agente seleccionado    │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket + HTTP (token auth)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  ENGINE = OpenClaw Gateway (sidecar embebido o remoto)      │
│  ├─ Tier 1: corre en la laptop del usuario                  │
│  ├─ Tier 2: corre en su Mac Mini                            │
│  └─ Tier 3: corre en VPS dedicada gestionada por nosotros   │
│                                                             │
│  Gestiona: agentes 24/7, channels, sandboxing, secretos    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Layout visual de la desktop app

```
┌──────────────┬──────────────────────────┬────────────────────┐
│              │                          │                    │
│  Chats       │  Chat activo             │  Canvas / UI       │
│              │                          │                    │
│  [Orquesta-  │  > usuario: hola         │  ┌──┐    ┌────┐    │
│   dor 🟢]    │  > agente: ¿en qué...    │  │T │───▶│Tool│    │
│              │                          │  └──┘    └────┘    │
│  [Finanzas   │  [streaming en vivo de   │     │       │      │
│   🟢]        │   eventos del agente]    │     ▼       ▼      │
│              │                          │  ┌──────────────┐  │
│  [Email      │                          │  │   Output     │  │
│   triage]    │                          │  └──────────────┘  │
│              │                          │                    │
│  + Nuevo     │  [input de chat]         │  [Canvas | UI]     │
│              │                          │  ←toggle           │
└──────────────┴──────────────────────────┴────────────────────┘
```

### 3.3 Mapeo de conceptos OpenClaw → Producto

| OpenClaw | Producto |
|---|---|
| Gateway | Engine (interno; usuario no ve este nombre) |
| Workspace | Agente (cada workspace = un agente con su propio chat, skills, memoria) |
| Skill | Capability del agente (cron, tools, lógica) |
| Session | Chat con un agente |
| Tool | Acción que el agente puede ejecutar |
| Channel | Canal externo (WhatsApp, Telegram, etc.) — V2 |

---

## 4. Estructura inicial del repo

```
agent-studio/
├── apps/
│   ├── desktop/              # Tauri + React (V1 foco)
│   │   ├── src/              # React frontend
│   │   ├── src-tauri/        # Rust backend (gestión de sidecar)
│   │   └── package.json
│   └── (mobile/)             # React Native — V2, no crear todavía
│
├── packages/
│   ├── engine-client/        # Cliente TS para hablar con OpenClaw Gateway
│   │   ├── src/
│   │   │   ├── websocket.ts  # Conexión WebSocket
│   │   │   ├── http.ts       # API REST
│   │   │   ├── events.ts     # Tipos de eventos
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── skills/               # Skills custom del producto
│   │   ├── agent-builder/    # Meta-agente que construye otros agentes
│   │   │   └── SKILL.md
│   │   └── templates/        # Plantillas flagship (V1 = 3-5)
│   │       ├── finance-tracker/
│   │       ├── email-triage/
│   │       └── habit-tracker/
│   │
│   └── canvas-parser/        # Parsea workspaces de OpenClaw → grafo visual
│       └── src/
│
├── scripts/
│   ├── poc-websocket.ts      # PoC de Fase 1 (script standalone)
│   └── setup-engine.sh       # Setup local del engine para dev
│
├── docs/
│   ├── PROJECT_BRIEF.md      # Este archivo
│   ├── ARCHITECTURE.md       # A escribir cuando avance
│   └── ENGINE_API.md         # Notas sobre la API de OpenClaw que usamos
│
├── package.json              # Workspace root (pnpm o bun)
├── pnpm-workspace.yaml       # (o equivalente bun)
└── README.md
```

**Nota:** monorepo con pnpm o bun workspaces. Todo TypeScript. Rust solo dentro de `src-tauri/`.

---

## 5. Plan de ejecución por fases

> **REGLA CRÍTICA:** No avances de fase hasta cumplir los criterios de éxito.
> Si una fase falla, regresa a debug, no inventes workarounds.

### FASE 0 — Pre-requisitos (asumir hechos)

- [x] OpenClaw instalado en la máquina del dev (`npm install -g openclaw@latest`)
- [x] OpenClaw onboardeado con `openclaw onboard --install-daemon`
- [x] API key de Claude o GPT conectada en OpenClaw
- [x] Gateway corriendo localmente en puerto default (18789)

**Si algo de esto falta, párate y pídeselo al usuario antes de continuar.**

---

### FASE 1 — Prueba de concepto: WebSocket al Gateway (script standalone)

**Objetivo:** Demostrar que un cliente custom puede hablar con el Gateway de OpenClaw vía WebSocket. Esto valida arquitectónicamente todo el producto.

**Tareas:**

1. Crear directorio `scripts/` en la raíz del repo
2. Crear `scripts/poc-websocket.ts` (TypeScript con `ts-node` o `bun`)
3. El script debe:
   - Leer el token del Gateway de `~/.openclaw/openclaw.json`
   - Conectarse vía WebSocket a `ws://localhost:18789` con auth header
   - Mandar un mensaje al agente principal
   - Imprimir TODOS los eventos recibidos en streaming
   - Cerrar limpiamente al recibir el evento de fin de respuesta
4. **Antes de escribir el script**, abrir el Control UI de OpenClaw en el navegador y usar DevTools (Network → WS) para inspeccionar el formato exacto de mensajes/eventos que usa. Documentar lo encontrado en `docs/ENGINE_API.md`.
5. Consultar la doc oficial: https://docs.openclaw.ai/reference/rpc

**Criterios de éxito:**

- [ ] El script se ejecuta sin errores
- [ ] Se conecta exitosamente al Gateway
- [ ] Manda un mensaje y recibe la respuesta del agente
- [ ] Los eventos se imprimen en consola en tiempo real (streaming, no batch al final)
- [ ] `docs/ENGINE_API.md` tiene documentado el formato de mensajes principales (al menos: enviar mensaje, evento de tool call, evento de respuesta del modelo, evento de fin)

**Tiempo estimado:** 1 día. Si toma más de 3 días, hay un problema arquitectónico que reportar al usuario.

**Output esperado:** un script funcional + un MD con documentación viva.

---

### FASE 2 — Cliente reusable de TypeScript (`packages/engine-client`)

**Objetivo:** Convertir el script PoC en un paquete reusable que la desktop app pueda importar.

**Tareas:**

1. Crear estructura de monorepo (pnpm workspaces o bun workspaces)
2. Crear paquete `packages/engine-client/`
3. Diseñar API limpia, ej:

```typescript
import { EngineClient } from '@agent-studio/engine-client'

const engine = new EngineClient({
  url: 'ws://localhost:18789',
  token: '...',
})

await engine.connect()

const session = engine.session('main')

session.on('message', (event) => { ... })
session.on('toolCall', (event) => { ... })

await session.send('hola')
```

4. Tipos de TypeScript exhaustivos para todos los eventos
5. Manejo robusto de reconexión si la conexión se cae
6. Tests unitarios mínimos con vitest

**Criterios de éxito:**

- [ ] Paquete instalable como dependencia local
- [ ] API tipada y documentada con JSDoc
- [ ] Reconexión automática funciona (probar matando el Gateway y reiniciándolo)
- [ ] Cubre al menos: send message, receive streaming events, tool calls, session lifecycle

---

### FASE 3 — Skill custom: `agent-builder`

**Objetivo:** Crear la skill que convierte a OpenClaw en un constructor de agentes vía conversación.

**Tareas:**

1. Crear `packages/skills/agent-builder/SKILL.md`
2. La skill debe enseñarle al agente principal cómo:
   - Hacer preguntas de clarificación cuando el usuario pide construir un agente
   - Generar la estructura de archivos de un nuevo agente (skill nueva en OpenClaw)
   - Usar tools de filesystem para crear los archivos correctos
   - Registrar crons si aplica
   - Confirmar con el usuario cuando termine
3. Crear 2-3 plantillas de referencia en `packages/skills/templates/`:
   - `finance-tracker/`
   - `email-triage/`
   - `habit-tracker/`
4. Instalar la skill en el workspace local de OpenClaw para testing
5. Probar conversacionalmente: "construye un agente que cada noche me mande un resumen de X"
6. Iterar el SKILL.md hasta que la generación sea consistente

**Criterios de éxito:**

- [ ] Skill instalada y reconocida por OpenClaw
- [ ] El agente puede generar 5 agentes distintos exitosamente sin intervención manual
- [ ] Los agentes generados son válidos (siguen estructura de OpenClaw, no rompen el Gateway)
- [ ] Al menos uno de los agentes generados ejecuta exitosamente su lógica al menos una vez

**Tiempo estimado:** 1-2 semanas. Esto es la pieza más arriesgada de calidad.

---

### FASE 4 — Desktop app mínima en Tauri

**Objetivo:** Primer "Hello World" visual del producto.

**Tareas:**

1. Crear `apps/desktop/` con `bun create tauri-app` (o `pnpm`) usando React + TS
2. Setup de Tailwind + shadcn/ui
3. **Una sola pantalla** con:
   - Input de chat
   - Lista vertical de mensajes (usuario y agente)
   - Indicador de "escribiendo..." cuando el agente procesa
   - Renderizado de eventos de tool calls de manera distinta al texto
4. La app importa `@agent-studio/engine-client`
5. Conexión al Gateway local (token de config local por ahora, hardcoded)
6. Eventos en streaming visibles en vivo

**Criterios de éxito:**

- [ ] La app compila y abre en macOS
- [ ] Puede conversar con el agente de OpenClaw desde la UI
- [ ] El streaming de respuesta se ve fluido (no esperando al final)
- [ ] Los tool calls se renderizan distinto al texto plano

**NO HACER en esta fase:** tres paneles, canvas, lista de agentes, branding bonito, multi-window. Solo el Hello World.

---

### FASE 5 — UI completa de tres paneles

**Objetivo:** El layout final del IDE.

**Tareas:**

1. Refactorizar el layout a tres paneles redimensionables
2. **Panel izquierdo:**
   - Lista de agentes (parsea workspaces de OpenClaw vía API del Gateway)
   - Estado por agente (vivo, pausado, error)
   - Botón "+ Nuevo agente" (crea workspace nuevo)
3. **Panel central:**
   - Chat con el agente seleccionado
   - Cada agente tiene su propia sesión persistente
   - Streaming de eventos en vivo
4. **Panel derecho:**
   - Canvas con React Flow
   - Parser que lee el workspace del agente seleccionado y construye nodos
   - Nodos: triggers, tools, conexiones
   - Toggle "Canvas | Logs"
   - Auto-layout con dagre

**Criterios de éxito:**

- [ ] Los tres paneles funcionan independientemente
- [ ] Cambiar de agente actualiza panel central y derecho
- [ ] Cada agente mantiene su historial de chat propio
- [ ] El canvas se actualiza en vivo cuando el agente ejecuta acciones

---

### FASE 6 — Sidecar de OpenClaw embebido

**Objetivo:** Que el usuario instale solo TU app, no OpenClaw separado.

**Tareas:**

1. Investigar el sistema de sidecar de Tauri 2.0 (https://tauri.app/v2/develop/sidecar/)
2. Compilar/descargar binarios de OpenClaw para macOS (Intel + ARM), Windows, Linux
3. Embeber binarios en `src-tauri/binaries/`
4. Escribir módulo Rust que:
   - Lance el binario al arrancar la app
   - Le pase env vars custom: `OPENCLAW_STATE_DIR=~/Library/Application Support/AgentStudio/engine/`, `OPENCLAW_GATEWAY_PORT=47192`, `OPENCLAW_GATEWAY_TOKEN=<random>`
   - Monitoree el proceso y lo reinicie si crashea
   - Lo apague limpiamente al cerrar la app
5. Generar token al primer arranque y persistirlo en config local de la app
6. Verificar que NO se cree el directorio `.openclaw` por ningún lado
7. Agregar menú "Acerca de > Open Source Licenses" con el copyright de OpenClaw (cumplimiento MIT)

**Criterios de éxito:**

- [ ] Una instalación limpia de la app NO requiere instalar OpenClaw aparte
- [ ] No existe `~/.openclaw` en el sistema después de usar la app
- [ ] El proceso del engine aparece con un nombre custom (no "openclaw")
- [ ] Si el engine crashea, la app lo reinicia automáticamente
- [ ] Cierre de app apaga limpiamente el engine

---

### FASE 7 — Demo público y validación

**Objetivo:** Saber si esto le importa a alguien antes de invertir más.

**Tareas:**

1. Grabar un video de 60-90 segundos mostrando el flujo completo:
   - Abrir app
   - Pedir "construye un agente que [X]"
   - Ver agente nacer en panel izquierdo y canvas a la derecha
   - Conversar con el agente
   - Mostrarlo ejecutando una vez
2. Postear en Twitter/X tagueando indie hackers
3. Postear en HackerNews y r/SideProject
4. Setup de waitlist (Tally form o Beehiiv)
5. Medir: views, signups, comentarios cualitativos

**Criterios de éxito:**

- [ ] Video grabado y publicado
- [ ] Al menos 100 signups en waitlist en primera semana
- [ ] Feedback cualitativo claro (qué excita, qué confunde)

---

### FASES POSTERIORES (NO ejecutar en V1)

- **FASE 8:** Provisioning automático de VPS por usuario (Hetzner API + Tailscale)
- **FASE 9:** Mac Mini bridge
- **FASE 10:** Mobile app companion
- **FASE 11:** Marketplace de agentes con revshare
- **FASE 12:** Billing con Stripe + suscripciones
- **FASE 13:** Generative UI por agente con deploys a Cloudflare Pages

**Cada una de estas merece su propio brief cuando llegue su momento.**

---

## 6. Consideraciones de seguridad (no ignorar)

- **Un Gateway por usuario, NUNCA compartido.** En V1 el usuario corre su propio engine local, así que está naturalmente aislado.
- Cuando llegue Tier 3 (VPS): cada usuario = una VPS dedicada. NO multi-tenant en un solo gateway.
- Aplicar baseline endurecido al engine al instalar:
  - `gateway.bind: "loopback"` (default, confirmar)
  - `gateway.auth.mode: "token"` con token random
  - `tools.profile: "messaging"` por default
  - `dmPolicy: "pairing"` para canales (cuando se agreguen)
- Correr `openclaw security audit --json` periódicamente y mostrar warnings al usuario en la app
- Para agentes que tocan datos sensibles (banco, salud), usar sandbox `mode: "all"` con `workspaceAccess: "none"` por default
- Secretos del usuario (API keys de servicios externos): NUNCA pasar por backend nuestro. Cliente → Engine local directo.

---

## 7. Stack técnico final (referencia rápida)

**Frontend desktop:**
- Tauri 2.0
- React 18 + TypeScript
- Vite
- Tailwind CSS
- shadcn/ui (componentes)
- React Flow (canvas)
- TanStack Query (state/cache)
- Zod (validación)

**Backend dentro de Tauri (Rust):**
- Tauri sidecar API
- tokio (async runtime)
- serde (serialización)

**Engine:**
- OpenClaw (sidecar embebido)

**Comunicación cliente ↔ engine:**
- WebSocket nativo
- HTTP/REST cuando aplique

**Tooling:**
- Bun o pnpm como package manager
- Vitest para tests
- Biome o ESLint + Prettier
- TypeScript strict mode

---

## 8. Convenciones de código

- TypeScript estricto. `any` prohibido salvo justificación documentada.
- Nombres en inglés en código, comentarios en español OK.
- Commits convencionales: `feat:`, `fix:`, `chore:`, `docs:`, etc.
- Cada paquete tiene su propio README explicando qué hace.
- No hacer commits con secretos (usar `.env.local` y `.gitignore`).
- Prefer composición sobre herencia.
- React: hooks > clases. Funciones puras donde se pueda.

---

## 9. Qué hacer cuando te atores

Si Claude Code se atora en alguna fase:

1. **NO inventes APIs de OpenClaw.** Consulta https://docs.openclaw.ai antes que generar código a ciegas.
2. **NO asumas formatos de mensajes.** Si dudas, abre el Control UI con DevTools y mira cómo OpenClaw mismo habla con su Gateway.
3. **NO saltes pasos del plan.** Si un criterio de éxito no se cumple, debug, no avance.
4. Reporta al usuario con: qué intentaste, qué falló, qué hipótesis tienes, qué necesitas decidir.

---

## 10. Primer comando concreto al empezar

Cuando Claude Code lea este brief y esté listo para empezar, su primera acción debe ser:

1. Verificar que OpenClaw está corriendo localmente: `openclaw status` o equivalente
2. Localizar el token del Gateway (probablemente en `~/.openclaw/openclaw.json`)
3. Crear la estructura inicial del repo (carpetas vacías + `package.json` raíz)
4. Empezar **FASE 1**: el script de PoC del WebSocket

**No crear Tauri ni la desktop app hasta cumplir los criterios de FASE 1 y FASE 2.**

---

## Apéndice: links de referencia

- OpenClaw docs: https://docs.openclaw.ai
- OpenClaw GitHub: https://github.com/openclaw/openclaw
- OpenClaw Gateway protocol: https://docs.openclaw.ai/reference/rpc
- OpenClaw Security: https://docs.openclaw.ai/gateway/security
- Tauri 2.0 docs: https://tauri.app/v2/
- Tauri sidecar guide: https://tauri.app/v2/develop/sidecar/
- React Flow: https://reactflow.dev/
- shadcn/ui: https://ui.shadcn.com/
- AG-UI protocol (referencia futura): https://docs.ag-ui.com/

---

**Fin del brief. Ejecutar de FASE 1 en adelante.**