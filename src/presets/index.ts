import type { PresetName, MessagePreset } from './types.js';
import { genZPreset } from './gen-z.js';
import { professionalPreset } from './professional.js';
import { devHumorPreset } from './dev-humor.js';
import { minimalPreset } from './minimal.js';
import { chaoticPreset } from './chaotic.js';
import { claudeAdvPreset } from './claude-adv.js';

export type { PresetName, MessagePreset } from './types.js';

export const PRESET_NAMES: PresetName[] = [
  'claude-adv',
  'minimal',
  'professional',
  'dev-humor',
  'gen-z',
  'chaotic',
];

export const PRESETS: Record<PresetName, MessagePreset> = {
  'claude-adv': claudeAdvPreset,
  'gen-z': genZPreset,
  professional: professionalPreset,
  'dev-humor': devHumorPreset,
  minimal: minimalPreset,
  chaotic: chaoticPreset,
};

export const DEFAULT_PRESET: PresetName = 'minimal';

export function getPreset(name: string): MessagePreset {
  if (name in PRESETS) {
    return PRESETS[name as PresetName];
  }
  return PRESETS[DEFAULT_PRESET];
}

export function isValidPreset(name: string): name is PresetName {
  return PRESET_NAMES.includes(name as PresetName);
}
