# OpenClaw Authentication (Model Providers)

> Fuente: https://docs.openclaw.ai/gateway/authentication

Este documento cubre la autenticación de **proveedores de modelos** (API keys, OAuth), no la auth del gateway (ver 03-GATEWAY-SECURITY.md).

---

## Setup de API Key (recomendado)

```bash
# 1. Crear key en consola del proveedor
# 2. Setear como env var
export ANTHROPIC_API_KEY="sk-ant-..."

# 3. Para daemons, guardar en ~/.openclaw/.env
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> ~/.openclaw/.env

# 4. Verificar
openclaw models status
```

---

## Métodos de auth para Anthropic

1. **Claude CLI reuse** (preferido si está instalado localmente):
   ```bash
   claude auth login
   openclaw models auth login --provider anthropic --method cli --set-default
   ```

2. **API key** (más predecible para servers)

3. **Setup-token** (legacy, aún soportado)

---

## Auth profiles

Archivo: `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`

```json
{
  "version": 1,
  "profiles": {
    "openrouter:default": {
      "type": "api_key",
      "provider": "openrouter",
      "key": "OPENROUTER_API_KEY"
    }
  }
}
```

Soporta SecretRef via `keyRef`/`tokenRef` para credenciales estáticas.

---

## Rotación de API keys

Prioridad cuando hay múltiples keys:
1. `OPENCLAW_LIVE_<PROVIDER>_KEY`
2. `<PROVIDER>_API_KEYS`
3. `<PROVIDER>_API_KEY`
4. `<PROVIDER>_API_KEY_*`

Retry solo en errores de rate-limit (429, quota exhausted, throttling).

---

## Selección de credenciales

- **Per-session:** `/model <alias>@<profileId>`
- **Per-agent:** `openclaw models auth order set --provider anthropic anthropic:default`

---

## Verificación

```bash
openclaw models status              # Estado de auth
openclaw models status --check      # Para automation (exit codes: 1=expired, 2=expiring)
openclaw models status --probe      # Probes de auth en vivo
openclaw doctor                     # Diagnóstico general
openclaw doctor --fix               # Migración de legacy
```
