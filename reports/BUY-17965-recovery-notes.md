# BUY-17965 Recovery Notes

## Heartbeat outcome
- Status reviewed: `blocked` heartbeat payload with immediate failure in adapter run.
- Failed step: `opencode_local` run could not start because model `openai/gpt-5.1-codex-mini` is unavailable in this environment.

## Root cause confirmed
- Runtime error text:
  - `Configured OpenCode model is unavailable: openai/gpt-5.1-codex-mini`
  - `Available models: deepseek/deepseek-chat, deepseek/deepseek-reasoner, deepseek/deepseek-v4-flash, deepseek/deepseek-v4-pro, ...`
- Adapter source resolved from prior run notes and re-opened:
  - `/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/adapter-opencode-local/dist/index.js`
- In that file, `modelProfiles.cheap.adapterConfig.model` still references `openai/gpt-5.1-codex-mini`.

## Durable unblock action
1. Replace deprecated OpenAI Codex IDs with available DeepSeek IDs in `/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/adapter-opencode-local/dist/index.js`.
2. Recommended minimum patch set:
   - `DEFAULT_OPENCODE_LOCAL_MODEL` → `deepseek/deepseek-reasoner`
   - `modelProfiles[cheap].adapterConfig.model` → `deepseek/deepseek-reasoner`
   - Optionally trim `models[]` list to available providers (`deepseek/*`)

## Why action is blocked right now
- File is root-owned in this workspace; write attempt fails due permissions (`Failed to write file ...`).
- `sudo` is unavailable in this environment (`sudo: command not found`).

## Next owner
- Required unblock owner: environment/runtime maintainer with write access to Paperclip adapter installation path above.
