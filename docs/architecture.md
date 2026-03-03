# Architecture

## Overview

claude-code-discord-status has two components that work together to show live Claude Code activity on Discord:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                               │
│                                                                  │
│  ┌──────────────┐                     ┌──────────────────────┐  │
│  │ Lifecycle     │──stdin (JSON)──────>│ Hook Script          │  │
│  │ Events        │                     │ (claude-hook.sh)     │  │
│  └──────────────┘                     └──────────┬───────────┘  │
│                                                   │              │
└───────────────────────────────────────────────────┼──────────────┘
                                                    │
                                                    │  HTTP POST
                                                    │
                                                    ▼
                        ┌────────────────────────────────┐
                        │           Daemon                │
                        │                                 │
                        │  ┌───────────┐  ┌───────────┐  │
                        │  │ HTTP      │  │ Session    │  │     IPC
                        │  │ Server    │──│ Registry   │──┼──────────> Discord
                        │  └───────────┘  └─────┬─────┘  │
                        │                       │         │
                        │                 ┌─────▼─────┐   │
                        │                 │ Presence   │   │
                        │                 │ Resolver   │   │
                        │                 └───────────┘   │
                        └─────────────────────────────────┘
```

## Components

### Daemon (`src/daemon/`)

The daemon is a long-running Node.js process that:

- **Listens** on `127.0.0.1:19452` (configurable) for HTTP requests
- **Tracks** all active Claude Code sessions in an in-memory registry
- **Resolves** what to show on Discord whenever sessions change
- **Pushes** the resolved activity to Discord via RPC
- **Cleans up** stale sessions (dead PIDs, idle timeouts)

Entry point: `src/daemon/index.ts` wires the registry, HTTP server, Discord client, and stale-check interval together.

#### Session Registry (`sessions.ts`)

In-memory `Map<string, Session>` with:

- `startSession()` — Creates a session with initial state and zero activity counters
- `updateActivity()` — Applies field updates, increments activity counters
- `endSession()` — Removes a session
- `checkStaleSessions()` — PID liveness check, idle/remove timeouts
- `findSessionByProjectPath()` — Used for session deduplication

Every mutation calls `notifyChange()` which triggers the presence resolver.

#### Presence Resolver (`resolver.ts`)

`resolvePresence(sessions, now?)` is the single entry point. Returns a `DiscordActivity` or `null`.

**Single session** (1): Shows the session's current `details` and `Working on {projectName}`. Uses the session's `smallImageKey` directly. This path is intentionally simple and never changed.

**Multi-session** (2+): Shows quirky messages and aggregate stats:

1. **Message selection** — `stablePick(pool, seed, now)` uses a Knuth multiplicative hash over 5-minute time buckets to select a message from the appropriate tier pool. The seed comes from the earliest session's `startedAt`, making it stable across updates.

2. **Stats line** — `formatStatsLine()` sums `ActivityCounts` across all sessions and formats as `"23 edits · 8 cmds · 2h 15m deep"`. Only non-zero stats appear. Singular/plural handled.

3. **Dominant mode** — `detectDominantMode()` maps activity counts to modes (edits→coding, commands→terminal, etc.). If one mode exceeds 50% of total, it becomes the `smallImageKey`. Otherwise defaults to `multi-session` (mixed).

4. **Tooltip** — Another `stablePick()` from the tooltip pool, with a different seed offset for variety.

#### HTTP Server (`server.ts`)

Simple HTTP server (no framework) with Zod request validation:

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Connection status, session count, uptime |
| `/sessions` | GET | List all sessions |
| `/sessions/:id/start` | POST | Register session (deduplicates by projectPath + pid) |
| `/sessions/:id/activity` | POST | Update session activity |
| `/sessions/:id/end` | POST | Remove session |

#### Discord Client (`discord.ts`)

Wrapper around `@xhayper/discord-rpc` with:

- Auto-reconnect on disconnect (every 5 seconds)
- `setActivity()` / `clearActivity()` methods
- Graceful `destroy()` on shutdown

### Hook Script (`src/hooks/claude-hook.sh`)

Bash script that receives Claude Code lifecycle events via stdin as JSON. Maps events to HTTP POSTs:

| Event | Action |
|---|---|
| `SessionStart` | Register session with daemon |
| `SessionEnd` | Remove session |
| `UserPromptSubmit` | Set status to "Thinking..." |
| `PreToolUse` | Set status based on tool (Write→coding, Bash→terminal, Read→reading, etc.) |
| `Stop` | Set status to "Finished" / idle |
| `Notification` | Set status to "Waiting for input" / idle |

The hook script always exits 0 to never block Claude Code. HTTP calls have 2-second timeouts.

## Key Design Decisions

### Session Deduplication

The `/sessions/:id/start` endpoint deduplicates by `projectPath + pid`. Two different Claude instances in the same folder (different PIDs) correctly get separate sessions.

### Stable Pick (Anti-Flicker)

Multi-session messages rotate every 5 minutes using time-bucketed hashing rather than random selection. This prevents the message from changing on every activity update while still providing variety over time.

### Activity Counters

Counters increment based on `smallImageKey` after field updates in `updateActivity()`. The `starting` and `idle` keys intentionally don't map to any counter.

## Data Flow Example

1. User types a prompt in Claude Code
2. `UserPromptSubmit` hook fires → POST `/sessions/abc/activity` with `{details: "Thinking...", smallImageKey: "thinking"}`
3. Daemon updates session, increments `thinks` counter, calls `notifyChange()`
4. `resolvePresence()` runs → returns `DiscordActivity`
5. `discord.setActivity()` pushes to Discord RPC
6. Discord shows updated card
