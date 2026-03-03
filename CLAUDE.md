# Claude Code Discord Status

## Project Overview

Discord Rich Presence integration for Claude Code. Shows what Claude is doing as a live activity card on Discord.

Two components: a **daemon** (background process holding the Discord RPC connection) and **hooks** (bash scripts fired by Claude Code lifecycle events).

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
npm run build        # Build with tsup
npm test             # Run tests (vitest run)
npm run test:watch   # Watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run format       # Prettier write
npm run format:check # Prettier check
```

Always run `npm run format && npm run typecheck && npm test` before committing.

## Project Structure

```
src/
├── cli.ts                 # CLI entry — setup, start, stop, status, uninstall
├── daemon/
│   ├── index.ts           # Daemon entry — wires registry, discord, server
│   ├── server.ts          # HTTP API (health, sessions CRUD)
│   ├── sessions.ts        # SessionRegistry — in-memory session store
│   ├── resolver.ts        # Presence resolver — turns sessions into Discord activity
│   └── discord.ts         # Discord RPC wrapper with auto-reconnect
├── hooks/
│   └── claude-hook.sh     # Bash hook script — maps lifecycle events to HTTP POSTs
└── shared/
    ├── types.ts           # All interfaces and types
    ├── constants.ts       # Ports, timeouts, image keys, message pools
    └── config.ts          # Config file + env var loader

tests/
├── daemon/
│   ├── resolver.test.ts   # Presence resolution, stats line, mode detection
│   ├── sessions.test.ts   # Session registry, activity counters, stale cleanup
│   └── server.test.ts     # HTTP API integration tests
└── shared/
    └── config.test.ts     # Config loading, env overrides
```

## Architecture

### Data Flow

```
Claude Code → Hook (bash) → HTTP POST → Daemon → Discord RPC
```

1. **Hooks** fire on lifecycle events (SessionStart, PreToolUse, Stop, etc.) and POST to the daemon's HTTP API
2. **Daemon** maintains a `SessionRegistry`, runs a `resolvePresence()` pass on every change, and pushes the result to Discord

### Key Concepts

- **Session**: One Claude Code instance. Tracked by session ID, has a project path, PID, activity counters, and current status
- **ActivityCounts**: Per-session counters (edits, commands, searches, reads, thinks) incremented based on `smallImageKey`
- **Session Deduplication**: `/sessions/:id/start` deduplicates by `projectPath + pid` to avoid duplicate sessions from the same Claude instance

### Single vs Multi-Session

- **Single session (1)**: Shows current action + project name. `buildSingleSessionActivity()` — do NOT modify this path
- **Multi-session (2+)**: Shows quirky tier-based messages + aggregate stats. `buildMultiSessionActivity()` with:
  - `stablePick()` — Knuth multiplicative hash over 5-minute time buckets for flicker-free message rotation
  - `formatStatsLine()` — Aggregates activity counts across sessions with elapsed time
  - `detectDominantMode()` — >50% threshold for dominant activity, otherwise "mixed"

### Resolver

`resolvePresence(sessions, now?)` is the single entry point. It returns a `DiscordActivity` or `null`. The `now` parameter exists for test determinism — always default in production.

### Constants

Message pools in `constants.ts`:
- `MULTI_SESSION_MESSAGES` — Keyed by session count (2, 3, 4)
- `MULTI_SESSION_MESSAGES_OVERFLOW` — For 5+ sessions, uses `{n}` placeholder
- `MULTI_SESSION_TOOLTIPS` — Hover text easter eggs
- `MODE_FLAVOR` — Per-activity-mode flavor text
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

Environment variables > config file > defaults:
- `CLAUDE_DISCORD_CLIENT_ID` → `discordClientId`
- `CLAUDE_DISCORD_PORT` → `daemonPort`

Config file: `~/.claude-discord-status/config.json`

## Git

- Branch: `main`
- Commit format: short, descriptive messages
- **Never add Co-Authored-By or any Claude/AI credit to commits**
- CI runs lint, format check, typecheck, test, build on Node 18/20/22
