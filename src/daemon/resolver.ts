import type { Session, DiscordActivity, ActivityCounts } from '../shared/types.js';
import type { MessagePreset } from '../presets/types.js';
import {
  LARGE_IMAGE_KEY,
  LARGE_IMAGE_TEXT,
  LARGE_IMAGE_URL,
  SMALL_IMAGE_URLS,
  MESSAGE_ROTATION_INTERVAL,
} from '../shared/constants.js';

const MAX_FIELD_LENGTH = 128;
const MIN_FIELD_LENGTH = 2;

export function resolvePresence(
  sessions: Session[],
  preset: MessagePreset,
  now: number = Date.now(),
): DiscordActivity | null {
  if (sessions.length === 0) return null;

  if (sessions.length === 1) {
    return buildSingleSessionActivity(sessions[0], preset, now);
  }

  return buildMultiSessionActivity(sessions, preset, now);
}

function buildSingleSessionActivity(
  session: Session,
  preset: MessagePreset,
  now: number,
): DiscordActivity {
  const pool =
    preset.singleSessionDetails[session.smallImageKey] ?? preset.singleSessionDetailsFallback;
  const flavorText = stablePick(pool, session.lastActivityAt, now);

  const state = preset.showSingleSessionStats
    ? formatSingleSessionStatsLine(session)
    : stablePick(preset.singleSessionStateMessages, session.startedAt + 1, now);

  return {
    details: sanitizeField(session.smallImageText) ?? flavorText,
    state,
    largeImageKey: LARGE_IMAGE_KEY,
    largeImageText: LARGE_IMAGE_TEXT,
    largeImageUrl: LARGE_IMAGE_URL,
    smallImageKey: session.smallImageKey,
    smallImageText: sanitizeField(flavorText),
    smallImageUrl: session.smallImageKey ? SMALL_IMAGE_URLS[session.smallImageKey] : undefined,
    startTimestamp: session.startedAt,
  };
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tokens`;
  return `${n} tokens`;
}

function formatSingleSessionStatsLine(session: Session): string {
  const parts: string[] = [];

  if (session.tokenCount > 0) parts.push(formatTokens(session.tokenCount));

  const { edits, commands, searches, reads, thinks } = session.activityCounts;
  if (edits > 0) parts.push(`${edits} ${edits === 1 ? 'edit' : 'edits'}`);
  if (commands > 0) parts.push(`${commands} ${commands === 1 ? 'cmd' : 'cmds'}`);
  if (searches > 0) parts.push(`${searches} ${searches === 1 ? 'search' : 'searches'}`);
  if (reads > 0) parts.push(`${reads} ${reads === 1 ? 'read' : 'reads'}`);
  if (thinks > 0) parts.push(`${thinks} ${thinks === 1 ? 'think' : 'thinks'}`);

  const joined = parts.join(' · ');
  if (joined.length < MIN_FIELD_LENGTH) return 'Session started';
  if (joined.length > MAX_FIELD_LENGTH) return joined.slice(0, MAX_FIELD_LENGTH - 1) + '…';
  return joined;
}

function buildMultiSessionActivity(
  sessions: Session[],
  preset: MessagePreset,
  now: number,
): DiscordActivity {
  const count = sessions.length;
  const earliest = sessions.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
  const seed = earliest.startedAt;

  // Pick details from tier-appropriate message pool
  const pool = preset.multiSessionMessages[count] ?? preset.multiSessionMessagesOverflow;
  let details = stablePick(pool, seed, now);
  if (count > 4) {
    details = details.replace(/\{n\}/g, String(count));
  }

  const state = formatStatsLine(sessions);
  const mostRecent = getMostRecentSession(sessions)!;
  const smallImageKey = mostRecent.smallImageKey;
  const smallImageText = stablePick(preset.multiSessionTooltips, seed + 1, now);

  return {
    details,
    state,
    largeImageKey: LARGE_IMAGE_KEY,
    largeImageText: LARGE_IMAGE_TEXT,
    largeImageUrl: LARGE_IMAGE_URL,
    smallImageKey,
    smallImageText: sanitizeField(smallImageText),
    smallImageUrl: smallImageKey ? SMALL_IMAGE_URLS[smallImageKey] : undefined,
    startTimestamp: earliest.startedAt,
  };
}

export function stablePick(pool: string[], seed: number, now: number): string {
  const bucket = Math.floor(now / MESSAGE_ROTATION_INTERVAL);
  const index = ((bucket * 2654435761 + seed) >>> 0) % pool.length;
  return pool[index];
}

export function formatStatsLine(sessions: Session[]): string {
  const totals: ActivityCounts & { tokens: number } = {
    edits: 0,
    commands: 0,
    searches: 0,
    reads: 0,
    thinks: 0,
    tokens: 0,
  };

  for (const session of sessions) {
    totals.edits += session.activityCounts.edits;
    totals.commands += session.activityCounts.commands;
    totals.searches += session.activityCounts.searches;
    totals.reads += session.activityCounts.reads;
    totals.thinks += session.activityCounts.thinks;
    totals.tokens += session.tokenCount;
  }

  const parts: string[] = [];
  if (totals.tokens > 0) parts.push(formatTokens(totals.tokens));
  if (totals.edits > 0) parts.push(`${totals.edits} ${totals.edits === 1 ? 'edit' : 'edits'}`);
  if (totals.commands > 0)
    parts.push(`${totals.commands} ${totals.commands === 1 ? 'cmd' : 'cmds'}`);
  if (totals.searches > 0)
    parts.push(`${totals.searches} ${totals.searches === 1 ? 'search' : 'searches'}`);
  if (totals.reads > 0) parts.push(`${totals.reads} ${totals.reads === 1 ? 'read' : 'reads'}`);
  if (totals.thinks > 0) parts.push(`${totals.thinks} ${totals.thinks === 1 ? 'think' : 'thinks'}`);

  const joined = parts.join(' \u00b7 ');
  if (joined.length === 0) return 'Just getting started';
  if (joined.length > MAX_FIELD_LENGTH) return joined.slice(0, MAX_FIELD_LENGTH - 1) + '\u2026';
  return joined;
}

export function detectDominantMode(
  sessions: Session[],
): 'coding' | 'terminal' | 'searching' | 'thinking' | 'mixed' {
  const totals = { coding: 0, terminal: 0, searching: 0, thinking: 0 };

  for (const session of sessions) {
    totals.coding += session.activityCounts.edits;
    totals.terminal += session.activityCounts.commands;
    totals.searching += session.activityCounts.searches;
    totals.thinking += session.activityCounts.thinks;
  }

  const total = totals.coding + totals.terminal + totals.searching + totals.thinking;
  if (total === 0) return 'mixed';

  const entries = Object.entries(totals) as [keyof typeof totals, number][];
  const [topMode, topCount] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));

  return topCount / total > 0.5 ? topMode : 'mixed';
}

export function getMostRecentSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;

  // Prefer active over idle, then most recent activity
  return sessions.reduce((best, current) => {
    if (best.status === 'active' && current.status === 'idle') return best;
    if (best.status === 'idle' && current.status === 'active') return current;
    return current.lastActivityAt > best.lastActivityAt ? current : best;
  });
}

function sanitizeField(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const truncated =
    value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH - 1) + '\u2026' : value;
  if (truncated.length < MIN_FIELD_LENGTH) return undefined;
  return truncated;
}
