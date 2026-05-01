import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:child_process and node:fs before importing hook module
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn(), pid: 12345 })),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ mtimeMs: 0 })),
    openSync: vi.fn(() => 99),
  };
});

import { processHookEvent } from '../src/hook.js';

function makeInput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    session_id: 'test-session',
    hook_event_name: 'SessionStart',
    cwd: '/tmp/project',
    ...overrides,
  });
}

describe('processHookEvent', () => {
  let fetchCalls: Array<{ url: string; body: unknown }>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/health')) {
        return new Response('{}', { status: 200 });
      }
      fetchCalls.push({
        url,
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does nothing for empty input', async () => {
    await processHookEvent('');
    expect(fetchCalls).toHaveLength(0);
  });

  it('does nothing for invalid JSON', async () => {
    await processHookEvent('not json');
    expect(fetchCalls).toHaveLength(0);
  });

  it('does nothing when session_id is missing', async () => {
    await processHookEvent(JSON.stringify({ hook_event_name: 'SessionStart' }));
    expect(fetchCalls).toHaveLength(0);
  });

  it('does nothing when hook_event_name is missing', async () => {
    await processHookEvent(JSON.stringify({ session_id: 'test' }));
    expect(fetchCalls).toHaveLength(0);
  });

  it('sends start + activity for SessionStart', async () => {
    await processHookEvent(makeInput());

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].url).toContain('/sessions/test-session/start');
    expect(fetchCalls[0].body).toMatchObject({ projectPath: '/tmp/project' });
    expect(fetchCalls[1].url).toContain('/sessions/test-session/activity');
    expect(fetchCalls[1].body).toMatchObject({
      details: 'Starting session...',
      smallImageKey: 'starting',
    });
  });

  it('sends resume message for SessionStart with resume matcher', async () => {
    await processHookEvent(makeInput({ matcher: 'resume' }));

    expect(fetchCalls[1].body).toMatchObject({
      details: 'Resuming session...',
    });
  });

  it('sends end for SessionEnd', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'SessionEnd' }));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain('/sessions/test-session/end');
  });

  it('sends thinking for UserPromptSubmit', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'UserPromptSubmit' }));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body).toMatchObject({
      details: 'Thinking...',
      smallImageKey: 'thinking',
    });
  });

  it('maps known tool to correct icon for PreToolUse', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body).toMatchObject({
      details: 'Running a command',
      smallImageKey: 'terminal',
    });
  });

  it('uses fallback for unknown tool in PreToolUse', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'PreToolUse', tool_name: 'UnknownTool' }));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body).toMatchObject({
      details: 'Working...',
      smallImageKey: 'coding',
    });
  });

  it('maps Write tool to coding icon', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'PreToolUse', tool_name: 'Write' }));

    expect(fetchCalls[0].body).toMatchObject({
      details: 'Editing a file',
      smallImageKey: 'coding',
    });
  });

  it('maps Read tool to reading icon', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'PreToolUse', tool_name: 'Read' }));

    expect(fetchCalls[0].body).toMatchObject({
      details: 'Reading a file',
      smallImageKey: 'reading',
    });
  });

  it('maps Grep tool to searching icon', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'PreToolUse', tool_name: 'Grep' }));

    expect(fetchCalls[0].body).toMatchObject({
      details: 'Searching codebase',
      smallImageKey: 'searching',
    });
  });

  it('maps Task tool to thinking icon', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'PreToolUse', tool_name: 'Task' }));

    expect(fetchCalls[0].body).toMatchObject({
      details: 'Running a subtask',
      smallImageKey: 'thinking',
    });
  });

  it('uses file basename as smallImageText for Edit', async () => {
    await processHookEvent(
      makeInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: '/home/user/project/src/daemon/resolver.ts' },
      }),
    );
    expect(fetchCalls[0].body).toMatchObject({ smallImageText: 'resolver.ts' });
  });

  it('uses file basename as smallImageText for Read', async () => {
    await processHookEvent(
      makeInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/home/user/project/src/hook.ts' },
      }),
    );
    expect(fetchCalls[0].body).toMatchObject({ smallImageText: 'hook.ts' });
  });

  it('uses command as smallImageText for Bash', async () => {
    await processHookEvent(
      makeInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      }),
    );
    expect(fetchCalls[0].body).toMatchObject({ smallImageText: 'npm test' });
  });

  it('truncates long Bash commands to 80 chars', async () => {
    const longCmd = 'a'.repeat(100);
    await processHookEvent(
      makeInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: longCmd },
      }),
    );
    expect(fetchCalls[0].body.smallImageText).toHaveLength(80);
  });

  it('uses pattern as smallImageText for Grep', async () => {
    await processHookEvent(
      makeInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'Grep',
        tool_input: { pattern: 'resolvePresence' },
      }),
    );
    expect(fetchCalls[0].body).toMatchObject({ smallImageText: 'resolvePresence' });
  });

  it('uses pattern as smallImageText for Glob', async () => {
    await processHookEvent(
      makeInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'Glob',
        tool_input: { pattern: 'src/**/*.ts' },
      }),
    );
    expect(fetchCalls[0].body).toMatchObject({ smallImageText: 'src/**/*.ts' });
  });

  it('uses query as smallImageText for WebSearch', async () => {
    await processHookEvent(
      makeInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'WebSearch',
        tool_input: { query: 'discord rich presence api' },
      }),
    );
    expect(fetchCalls[0].body).toMatchObject({ smallImageText: 'discord rich presence api' });
  });

  it('uses hostname as smallImageText for WebFetch', async () => {
    await processHookEvent(
      makeInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'WebFetch',
        tool_input: { url: 'https://discord.com/developers/docs' },
      }),
    );
    expect(fetchCalls[0].body).toMatchObject({ smallImageText: 'discord.com' });
  });

  it('falls back to generic iconText when tool_input is absent', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }));
    expect(fetchCalls[0].body).toMatchObject({ smallImageText: 'Running a command' });
  });

  it('sends idle for Stop', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'Stop' }));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body).toMatchObject({
      details: 'Finished',
      smallImageKey: 'idle',
    });
  });

  it('sends idle for Notification', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'Notification' }));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body).toMatchObject({
      details: 'Waiting for input',
      smallImageKey: 'idle',
    });
  });

  it('ignores unknown event types', async () => {
    await processHookEvent(makeInput({ hook_event_name: 'SomeNewEvent' }));

    expect(fetchCalls).toHaveLength(0);
  });
});
