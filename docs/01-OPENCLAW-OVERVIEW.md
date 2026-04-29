# OpenClaw — Overview

> Fuente: https://docs.openclaw.ai

## Qué es OpenClaw

OpenClaw es un **gateway open-source (MIT)** auto-hospedado que conecta agentes de IA con 30+ plataformas de mensajería simultáneamente. Un solo proceso Gateway corre en tu máquina, sirviendo como el control plane para Discord, Slack, Telegram, WhatsApp, iMessage, Signal, Matrix, Microsoft Teams, Google Chat, Zalo, y más.

**Filosofía:** soberanía de datos, control operativo, desarrollo comunitario.

**Requisitos:** Node 24 (recomendado) o Node 22.14+, API key de un proveedor.

## Arquitectura

```
Chat apps + plugins → Gateway → Agente(s) IA, CLI, Web Control UI, macOS app, iOS/Android nodes
```

El Gateway es el single source of truth para sesiones, routing y conexiones de canales.

### Puerto y multiplexado

Un solo puerto (default **18789**) maneja:
- WebSocket control/RPC
- HTTP APIs (OpenAI-compatible: `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`)
- Control UI (dashboard en navegador)
- Hooks y automatización

### Bind modes

| Bind | Exposición |
|------|-----------|
| `loopback` | Solo local (default) |
| `lan` | Red local (requiere firewall + auth) |
| `tailnet` | Red Tailscale |
| `custom` | Personalizado |

## Conceptos clave

| Concepto | Descripción |
|----------|-------------|
| **Gateway** | Proceso central que multiplexa todo |
| **Agent** | Runtime embebido con tool streaming, soporta 35+ proveedores |
| **Session** | Contexto de conversación; scoping inteligente por canal/sender |
| **Tool** | Función estructurada que el agente invoca (exec, browser, web_search, etc.) |
| **Skill** | Archivo markdown inyectado al system prompt |
| **Plugin** | Paquete que agrupa channels, providers, tools, skills |
| **Channel** | Integración con plataforma de mensajería |
| **Node** | App companion (iOS, Android, macOS) que se parea con el Gateway |
| **Workspace** | Directorio de trabajo de un agente |

## Quick Start

```bash
# Instalar
npm install -g openclaw@latest

# Onboarding (configura proveedor, API key, daemon)
openclaw onboard --install-daemon

# Verificar
openclaw gateway status

# Abrir dashboard
openclaw dashboard   # → http://127.0.0.1:18789/
```

## Configuración

Archivo: `~/.openclaw/openclaw.json` (JSON5)

```json5
{
  agent: { model: "<provider>/<model-id>" },
  agents: { defaults: { workspace: "~/.openclaw/workspace" } },
  channels: {
    whatsapp: {
      allowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } },
    },
  },
}
```

### Variables de entorno clave

| Variable | Uso |
|----------|-----|
| `OPENCLAW_HOME` | Directorio home custom |
| `OPENCLAW_STATE_DIR` | Directorio de estado custom |
| `OPENCLAW_CONFIG_PATH` | Path al config custom |
| `OPENCLAW_GATEWAY_PORT` | Puerto custom |
| `OPENCLAW_GATEWAY_TOKEN` | Token de auth |
| `OPENCLAW_GATEWAY_PASSWORD` | Password de auth |

## Capacidades

- **30+ canales** de mensajería integrados
- **70+ proveedores** de modelos IA
- **Endpoints OpenAI-compatible** (`/v1/*`)
- **Media:** imágenes, audio, video, documentos (bidireccional)
- **VoiceClaw:** voz en tiempo real vía WebSocket con Gemini Live
- **Sandboxing:** aislamiento Docker opcional
- **Hot reload:** config se aplica sin restart (modo hybrid por default)
- **Supervisión:** soporte nativo para launchd (macOS), systemd (Linux), schtasks (Windows)

## Proveedores soportados (35+)

Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Mistral, Ollama, LM Studio, vLLM, SGLang, OpenRouter, y más.

## Documentación completa

- Docs: https://docs.openclaw.ai
- GitHub: https://github.com/openclaw/openclaw
- Índice completo: https://docs.openclaw.ai/llms.txt
