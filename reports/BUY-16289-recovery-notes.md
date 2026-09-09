# BUY-16289 Recovery Notes

Issue: Recover stalled issue BUY-9328
Status target: `blocked` (runtime dependency)

## Root cause confirmed
- Latest retry failed with:
  - `Configured OpenCode model is unavailable: openai/gpt-5.1-codex-mini`
  - Available list includes deepseek/minimax variants only.
- Failure occurs when adapter `opencode_local` is invoked.

## Concrete evidence collected
- Adapter source resolved at runtime:
  - `/usr/local/lib/node_modules/paperclipai/node_modules/@paperclipai/adapter-opencode-local/dist/index.js`
- File contains:
  - `DEFAULT_OPENCODE_LOCAL_MODEL = "openai/gpt-5.2-codex"`
  - `modelProfiles` cheap lane uses `openai/gpt-5.1-codex-mini`
  - Model list included unavailable OpenAI IDs.
- File is not writable in this environment (permission denied on `/usr/local/lib/...`).

## Recommended unblock action (first-class)
1. Patch adapter defaults in deploy image/worktree to a currently available model (e.g. `deepseek/deepseek-reasoner`).
2. Re-run recovery for source issue `BUY-9328`.
3. If model is configured per-run, override `opencode_local` model in issue/agent config rather than hardcoding old OpenAI IDs.

## Extra note
- I attempted `paperclipai issue update` to mark status/comment on BUY-16289 but API was unreachable from this environment (`Could not reach the Paperclip API at http://paperclipclean-production.up.railway.app:3100`).
