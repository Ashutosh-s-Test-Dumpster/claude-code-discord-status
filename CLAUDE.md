# Claude Code Discord Status

## Project Overview

Discord Rich Presence integration for Claude Code. Shows what Claude is doing as a live activity card on Discord.

Two components: a **daemon** (background process holding the Discord RPC connection) and **hooks** (scripts fired by Claude Code lifecycle events). There are two hook implementations: a bash script (`claude-hook.sh`) for macOS/Linux and a Node.js script (`hook.ts`) for Windows (and as a cross-platform fallback).

## Tech Stack

- **Runtime**: Node.js >= 18
- **Language**: TypeScript (strict mode, ES2022, NodeNext modules)
- **Build**: tsup (2 entry points: cli, daemon)
- **Test**: Vitest
- **Lint**: ESLint (typescript-eslint recommended)
- **Format**: Prettier
- **Dependencies**: `@xhayper/discord-rpc`, `zod`

## Commands

```bash
npm run build          # Build with tsup
npm test               # Run tests (vitest run)
npm run test:watch     # Watch mode
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run format         # Prettier write
npm run format:check   # Prettier check
npm run unix-deploy    # Build, install globally, restart daemon (macOS/Linux)
npm run windows-deploy # Build, install globally, restart daemon (Windows)
```

Always run `npm run format && npm run typecheck && npm test` before committing.

## Project Structure

```
src/
├── cli.ts                 # CLI entry — setup, start, stop, status, uninstall
├── cli-utils.ts           # Shared CLI helpers
├── doctor.ts              # Doctor command — diagnose and auto-fix issues
├── hook.ts                # Node.js hook — Windows/cross-platform lifecycle handler
├── daemon/
│   ├── index.ts           # Daemon entry — wires registry, discord, server
│   ├── server.ts          # HTTP API (health, sessions CRUD)
│   ├── sessions.ts        # SessionRegistry — in-memory session store
│   ├── resolver.ts        # Presence resolver — turns sessions into Discord activity
│   └── discord.ts         # Discord RPC wrapper with auto-reconnect
├── hooks/
│   └── claude-hook.sh     # Bash hook script — maps lifecycle events to HTTP POSTs
├── presets/
│   ├── types.ts           # MessagePreset interface
│   ├── index.ts           # Preset registry and loader
│   ├── gen-z.ts           # Default preset (quirky, meme-flavored)
│   ├── minimal.ts         # Clean, minimal messages
│   ├── professional.ts    # Professional tone
│   ├── dev-humor.ts       # Developer humor
│   ├── chaotic.ts         # Chaotic energy
│   └── claude-adv.ts      # Claude adventure theme
└── shared/
    ├── types.ts           # All interfaces and types
    ├── constants.ts       # Ports, timeouts, image keys, message pools
    ├── config.ts          # Config file + env var loader
    ├── migration.ts       # Legacy path migration (~/.claude-discord-status → ~/.claude-presence)
    ├── update-checker.ts  # npm registry version check
    ├── changelog.ts       # Changelog fetch and display
    └── version.ts         # Package version

tests/
├── hook.test.ts           # Node.js hook unit tests
├── cli/
│   ├── hook-config.test.ts
│   ├── migration.test.ts
│   └── doctor.test.ts
├── daemon/
│   ├── resolver.test.ts   # Presence resolution, stats line, mode detection
│   ├── sessions.test.ts   # Session registry, activity counters, stale cleanup
│   └── server.test.ts     # HTTP API integration tests
├── presets/
│   └── presets.test.ts    # Preset structure validation
└── shared/
    ├── config.test.ts     # Config loading, env overrides
    ├── update-checker.test.ts
    └── changelog.test.ts
```

## Architecture

### Data Flow

```
Claude Code → Hook (bash or Node.js) → HTTP POST → Daemon → Discord RPC
```

1. **Hooks** fire on lifecycle events (SessionStart, PreToolUse, Stop, etc.) and POST to the daemon's HTTP API. Both hooks auto-start the daemon if it's not running.
2. **Daemon** maintains a `SessionRegistry`, runs a `resolvePresence()` pass on every change, and pushes the result to Discord

### Key Concepts

- **Session**: One Claude Code instance. Tracked by session ID, has a project path, PID, activity counters, and current status
- **ActivityCounts**: Per-session counters (edits, commands, searches, reads, thinks) incremented based on `smallImageKey`
- **Session Deduplication**: `/sessions/:id/start` deduplicates by `projectPath + pid` to avoid duplicate sessions from the same Claude instance
- **Preset**: A `MessagePreset` object that supplies all message pools. Selected via config or `CLAUDE_PRESENCE_PRESET` env var. Default is `minimal`.

### Single vs Multi-Session

- **Single session (1)**: `buildSingleSessionActivity()` — `details` shows the session's current `smallImageText` (e.g. "Editing hook.ts"), `smallImageText` (icon tooltip) shows a rotating flavor line from the preset pool keyed by `smallImageKey`
- **Multi-session (2+)**: `buildMultiSessionActivity()` — shows quirky tier-based messages + aggregate stats:
  - `stablePick()` — Knuth multiplicative hash over 5-minute time buckets for flicker-free message rotation
  - `formatStatsLine()` — Aggregates activity counts across sessions
  - `detectDominantMode()` — >50% threshold for dominant activity, otherwise "mixed"

### Resolver

`resolvePresence(sessions, preset, now?)` is the single entry point. It returns a `DiscordActivity` or `null`. The `now` parameter exists for test determinism — always default in production.

### Token Counting

The `Stop` hook reads `output_tokens` from the transcript JSONL and **sums across all assistant turns** (not just the last). Cache tokens are excluded.

### Constants

Message pools in `constants.ts`:
- `SINGLE_SESSION_DETAILS` — Per-`smallImageKey` flavor pools for single-session `smallImageText`
- `SINGLE_SESSION_DETAILS_FALLBACK` — Fallback pool when `smallImageKey` is unrecognized
- `SINGLE_SESSION_STATE_MESSAGES` — Rotating state line messages
- `MULTI_SESSION_MESSAGES` — Keyed by session count (2, 3, 4)
- `MULTI_SESSION_MESSAGES_OVERFLOW` — For 5+ sessions, uses `{n}` placeholder
- `MULTI_SESSION_TOOLTIPS` — Hover text easter eggs
- `MESSAGE_ROTATION_INTERVAL` — 5 minutes between message rotations

## Conventions

### Types

- All data types live in `src/shared/types.ts`
- Use `interface` for object shapes
- Use factory functions for defaults (e.g., `emptyActivityCounts()`)

### Testing

- Tests mirror `src/` structure under `tests/`
- Use `makeSession()` helper with partial overrides in resolver tests
- Test files import from source via relative paths with `.js` extension
- Server tests use a real HTTP server on port 0

### Discord Field Limits

- `details` and `state`: min 2, max 128 characters
- `sanitizeField()` in resolver handles truncation
- Image keys must match assets uploaded to the Discord Developer Portal

### HTTP API

All endpoints on `127.0.0.1:{port}`:
- `GET /health` — `{ connected, sessions, uptime }`
- `GET /sessions` — Array of all sessions
- `POST /sessions/:id/start` — `{ pid, projectPath }` → 201 (or 200 if deduped)
- `POST /sessions/:id/activity` — `{ details?, smallImageKey?, smallImageText? }`
- `POST /sessions/:id/end` — Removes session

### Config Precedence

Environment variables > config file > defaults. New `CLAUDE_PRESENCE_*` names take precedence; old `CLAUDE_DISCORD_*` names work as fallback:
- `CLAUDE_PRESENCE_CLIENT_ID` / `CLAUDE_DISCORD_CLIENT_ID` → `discordClientId`
- `CLAUDE_PRESENCE_PORT` / `CLAUDE_DISCORD_PORT` → `daemonPort`
- `CLAUDE_PRESENCE_PRESET` / `CLAUDE_DISCORD_PRESET` → `preset`

Config file: `~/.claude-presence/config.json` (legacy: `~/.claude-discord-status/config.json`, auto-migrated)

## Git

- Branch: `main`
- Commit format: short, descriptive messages
- **Never add Co-Authored-By or any Claude/AI credit to commits**
- CI runs lint, format check, typecheck, test, build on Node 18/20/22
