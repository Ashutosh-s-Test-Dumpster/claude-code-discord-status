export type PresetName =
  | 'gen-z'
  | 'professional'
  | 'dev-humor'
  | 'minimal'
  | 'chaotic'
  | 'claude-adv';

export interface MessagePreset {
  /** Human-readable name for CLI display */
  label: string;
  /** Short description for CLI selection */
  description: string;
  /** Rotating state messages for single-session mode */
  singleSessionStateMessages: string[];
  /** Per-action detail messages for single-session mode */
  singleSessionDetails: Record<string, string[]>;
  /** Fallback details when action key is unknown */
  singleSessionDetailsFallback: string[];
  /** Tier-based messages for multi-session mode (keyed by 2, 3, 4) */
  multiSessionMessages: Record<number, string[]>;
  /** Messages for 5+ sessions, with {n} placeholder */
  multiSessionMessagesOverflow: string[];
  /** Hover tooltip text for multi-session mode */
  multiSessionTooltips: string[];
  /** When true, single-session state line shows live stats instead of a rotating message */
  showSingleSessionStats?: boolean;
  /** When false, project/repo name is hidden from the single-session stats line (default: true) */
  showProjectName?: boolean;
}
