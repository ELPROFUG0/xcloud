# OpenClaw Tools & Skills

> Fuente: https://docs.openclaw.ai/tools

## Arquitectura de tres capas

1. **Tools** — Funciones tipadas que el agente invoca (exec, browser, web_search, message, etc.)
2. **Skills** — Archivos markdown (`SKILL.md`) inyectados al system prompt del agente
3. **Plugins** — Paquetes que agrupan channels, providers, tools, skills, speech, media, etc.

---

## Tools built-in

| Tool | Función |
|------|---------|
| `exec` / `process` | Ejecutar comandos shell, gestionar procesos |
| `code_execution` | Python sandboxed remoto |
| `browser` | Controlar Chromium (navegar, click, screenshot) |
| `web_search` / `x_search` / `web_fetch` | Buscar web, posts X, fetch páginas |
| `read` / `write` / `edit` | I/O de archivos en workspace |
| `apply_patch` | Patches multi-hunk |
| `message` | Enviar mensajes cross-channel |
| `canvas` | Controlar Canvas de node (present, eval, snapshot) |
| `nodes` | Descubrir y targetear dispositivos pareados |
| `cron` / `gateway` | Gestionar jobs programados; inspeccionar/patchear gateway |
| `image` / `image_generate` | Analizar o generar imágenes |
| `music_generate` | Generar música |
| `video_generate` | Generar video |
| `tts` | Text-to-speech |
| `sessions_*` / `subagents` / `agents_list` | Gestión de sesiones, sub-agentes |
| `session_status` | Status y override de modelo por sesión |

---

## Tool profiles

| Profile | Incluye |
|---------|---------|
| `full` | Sin restricciones (default si no se configura) |
| `coding` | fs, runtime, web, sessions, memory, cron, media |
| `messaging` | Solo messaging, sessions básicos |
| `minimal` | Solo session_status |

```json5
{ tools: { profile: "coding" } }
```

---

## Tool groups

| Grupo | Tools |
|-------|-------|
| `group:runtime` | exec, process, code_execution |
| `group:fs` | read, write, edit, apply_patch |
| `group:sessions` | sessions_list/history/send/spawn/yield, subagents, session_status |
| `group:memory` | memory_search, memory_get |
| `group:web` | web_search, x_search, web_fetch |
| `group:ui` | browser, canvas |
| `group:automation` | cron, gateway |
| `group:messaging` | message |
| `group:nodes` | nodes |
| `group:agents` | agents_list |
| `group:media` | image, image_generate, music_generate, video_generate, tts |
| `group:openclaw` | Todos los built-in (excluye plugins) |

---

## Allow/Deny

```json5
{
  tools: {
    allow: ["group:fs", "browser", "web_search"],
    deny: ["exec"],   // deny SIEMPRE gana
  }
}
```

Si allowlist explícito resuelve a 0 tools callable → el run se detiene antes de llamar al modelo.

---

## Gateway tool (owner-only)

Operaciones:
- `config.schema.lookup` — schema por subtree
- `config.get` — snapshot + hash
- `config.patch` — updates parciales con restart
- `config.apply` — reemplazo completo
- `update.run` — self-update + restart

**Protegido:** no permite cambiar `tools.exec.ask` ni `tools.exec.security`.

---

## Skills

Las skills son archivos `SKILL.md` que se inyectan al system prompt del agente:

- Proveen contexto, restricciones y guías paso a paso
- Residen en workspaces, carpetas compartidas o dentro de plugins
- Se pueden refrescar mid-session

### Ubicación
- Workspace del agente: `~/.openclaw/workspace/skills/<skill-name>/SKILL.md`
- Skills compartidas: configurables en config

### Restricción por agente
```json5
{
  agents: {
    defaults: {
      skills: ["github", "weather"],   // default para todos
    },
    list: [
      { id: "writer" },                // hereda defaults
      { id: "docs", skills: ["docs-search"] },  // override
      { id: "locked-down", skills: [] },         // sin skills
    ],
  }
}
```

---

## Plugins

Paquetes que agregan funcionalidades:
- Channels, providers, tools, skills, speech, transcription, voice, media, web services
- Core (shipped con OpenClaw) vs External (community npm)
- Corren in-process con el gateway → tratar como código trusted
- Usar `plugins.allow` para allowlists explícitas

### Plugin tools de ejemplo
- **Diffs** — diff viewer
- **LLM Task** — paso JSON-only para structured output
- **Lobster** — workflow runtime con approvals resumables
- **OpenProse** — orquestación markdown-first
- **Tokenjuice** — compactar resultados de exec/bash
