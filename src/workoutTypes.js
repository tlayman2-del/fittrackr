// ─── FitTrackr Workout Types ──────────────────────────────────────────────────
// Canonical workout type list, legacy alias mapping, and mesocycle bias mapping.
// This file lives in the app bundle — never fetched from Firestore.

// Canonical list for new users and all UI dropdowns going forward.
// Cardio and Recovery intentionally excluded — handled via alias only.
export const DEFAULT_WORKOUT_TYPES = [
  'Hypertrophy',
  'Strength Bias',
  'Power Bias',
  'General',
];

// Maps all known workout type values (legacy and current) to their
// canonical display name. Applied everywhere workout type is read —
// pre-workout screen, history display, analytics filters, suggestion engine.
// No Firestore writes needed — translation happens at read time.
export const WORKOUT_TYPE_ALIASES = {
  // Legacy → new
  'Strength':           'Strength Bias',
  'Power':              'Power Bias',
  'Cardio':             'General',
  'Recovery':           'General',
  // Current → current (identity mappings for safe lookup on any value)
  'Hypertrophy':        'Hypertrophy',
  'Strength Bias':      'Strength Bias',
  'Power Bias':         'Power Bias',
  'General':            'General',
};

// Maps mesocycle bias to the workout types that should default the
// mesocycle association prompt to "yes" on the pre-workout screen.
export const BIAS_WORKOUT_TYPE_MAP = {
  'hypertrophy':    ['Hypertrophy'],
  'strength_bias':  ['Strength Bias'],
  'power_bias':     ['Power Bias'],
};

// Helper: resolve any stored workout type value to its canonical display name.
// Returns 'General' as fallback for unknown values.
export function resolveWorkoutType(value) {
  if (!value) return 'General';
  return WORKOUT_TYPE_ALIASES[value] ?? 'General';
}
