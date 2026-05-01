import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  PRESET_NAMES,
  DEFAULT_PRESET,
  getPreset,
  isValidPreset,
} from '../../src/presets/index.js';

describe('presets', () => {
  it('exports all expected preset names', () => {
    expect(PRESET_NAMES).toEqual([
      'claude-adv',
      'minimal',
      'professional',
      'dev-humor',
      'gen-z',
      'chaotic',
    ]);
  });

  it('has a valid default preset', () => {
    expect(DEFAULT_PRESET).toBe('minimal');
    expect(PRESETS[DEFAULT_PRESET]).toBeDefined();
  });

  const requiredDetailKeys = [
    'coding',
    'terminal',
    'searching',
    'thinking',
    'reading',
    'idle',
    'starting',
  ];

  for (const name of PRESET_NAMES) {
    describe(`preset: ${name}`, () => {
      const preset = PRESETS[name];

      it('has a label and description', () => {
        expect(preset.label.length).toBeGreaterThan(0);
        expect(preset.description.length).toBeGreaterThan(0);
      });

      it('has non-empty singleSessionStateMessages', () => {
        expect(preset.singleSessionStateMessages.length).toBeGreaterThan(0);
      });

      it('has all required action keys in singleSessionDetails', () => {
        for (const key of requiredDetailKeys) {
          expect(preset.singleSessionDetails[key]?.length).toBeGreaterThan(0);
        }
      });

      it('has non-empty singleSessionDetailsFallback', () => {
        expect(preset.singleSessionDetailsFallback.length).toBeGreaterThan(0);
      });

      it('has multi-session messages for tiers 2, 3, 4', () => {
        for (const tier of [2, 3, 4]) {
          expect(preset.multiSessionMessages[tier]?.length).toBeGreaterThan(0);
        }
      });

      it('has non-empty multiSessionMessagesOverflow with {n} placeholder', () => {
        expect(preset.multiSessionMessagesOverflow.length).toBeGreaterThan(0);
        const hasPlaceholder = preset.multiSessionMessagesOverflow.some((m) => m.includes('{n}'));
        expect(hasPlaceholder).toBe(true);
      });

      it('has non-empty multiSessionTooltips', () => {
        expect(preset.multiSessionTooltips.length).toBeGreaterThan(0);
      });

      it('all messages respect Discord field limits (2-128 chars)', () => {
        const allPools = [
          ...preset.singleSessionStateMessages,
          ...preset.singleSessionDetailsFallback,
          ...Object.values(preset.singleSessionDetails).flat(),
          ...Object.values(preset.multiSessionMessages).flat(),
          ...preset.multiSessionMessagesOverflow,
          ...preset.multiSessionTooltips,
        ];
        for (const msg of allPools) {
          expect(msg.length, `"${msg}" is too short`).toBeGreaterThanOrEqual(2);
          expect(msg.length, `"${msg}" is too long`).toBeLessThanOrEqual(128);
        }
      });
    });
  }
});

describe('getPreset', () => {
  it('returns the correct preset for valid names', () => {
    for (const name of PRESET_NAMES) {
      expect(getPreset(name)).toBe(PRESETS[name]);
    }
  });

  it('falls back to minimal for unknown names', () => {
    expect(getPreset('nonexistent')).toBe(PRESETS['minimal']);
  });

  it('falls back to minimal for empty string', () => {
    expect(getPreset('')).toBe(PRESETS['minimal']);
  });
});

describe('isValidPreset', () => {
  it('returns true for valid preset names', () => {
    for (const name of PRESET_NAMES) {
      expect(isValidPreset(name)).toBe(true);
    }
  });

  it('returns false for invalid names', () => {
    expect(isValidPreset('unknown')).toBe(false);
    expect(isValidPreset('')).toBe(false);
    expect(isValidPreset('Professional')).toBe(false);
  });
});
