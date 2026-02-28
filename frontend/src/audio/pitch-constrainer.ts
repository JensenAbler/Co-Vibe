/**
 * Pitch constrainer — snaps MIDI note numbers to the current key/chord.
 *
 * "Approach A" from the design doc: constrain the control signal (MIDI note),
 * not the audio. Pure functions, no side effects, zero latency.
 */

import type { KeyInfo } from "../types/song-outline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface HarmonicContext {
  scalePitchClasses: Set<PitchClass>;
  chordPitchClasses: Set<PitchClass>;
}

// ---------------------------------------------------------------------------
// Note name → pitch class
// ---------------------------------------------------------------------------

const NOTE_TO_PC: Record<string, PitchClass> = {
  C: 0, "C#": 1, Db: 1,
  D: 2, "D#": 3, Eb: 3,
  E: 4, Fb: 4, "E#": 5,
  F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8,
  A: 9, "A#": 10, Bb: 10,
  B: 11, Cb: 11, "B#": 0,
};

// ---------------------------------------------------------------------------
// Scale intervals from root (semitones)
// ---------------------------------------------------------------------------

const SCALE_INTERVALS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// ---------------------------------------------------------------------------
// Chord quality → intervals from root (semitones)
// ---------------------------------------------------------------------------

const CHORD_INTERVALS: Record<string, number[]> = {
  // Major triads
  "": [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],

  // Minor triads
  m: [0, 3, 7],
  min: [0, 3, 7],
  "-": [0, 3, 7],

  // Dominant 7th
  "7": [0, 4, 7, 10],

  // Major 7th
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],

  // Minor 7th
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  "-7": [0, 3, 7, 10],

  // Diminished
  dim: [0, 3, 6],
  o: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  o7: [0, 3, 6, 9],

  // Half-diminished
  m7b5: [0, 3, 6, 10],

  // Augmented
  aug: [0, 4, 8],
  "+": [0, 4, 8],

  // Suspended
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  sus: [0, 5, 7],

  // Extended
  "9": [0, 4, 7, 10, 2],
  m9: [0, 3, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  add9: [0, 4, 7, 2],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
};

// ---------------------------------------------------------------------------
// Root extraction regex
// ---------------------------------------------------------------------------

const ROOT_RE = /^([A-G][b#]?)/;

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

export function tonicNameToPitchClass(name: string): PitchClass | null {
  return NOTE_TO_PC[name] ?? null;
}

export function buildScale(
  tonic: string,
  mode: "major" | "minor",
): PitchClass[] {
  const root = tonicNameToPitchClass(tonic);
  if (root === null) return [];

  const intervals = SCALE_INTERVALS[mode];
  return intervals.map((i) => ((root + i) % 12) as PitchClass);
}

export function parseChord(symbol: string): PitchClass[] {
  if (!symbol || symbol === "N") return [];

  const match = symbol.match(ROOT_RE);
  if (!match) return [];

  const rootName = match[1];
  const root = tonicNameToPitchClass(rootName);
  if (root === null) return [];

  const quality = symbol.slice(rootName.length);
  const intervals = CHORD_INTERVALS[quality];

  if (!intervals) {
    // Unknown quality — use root only as a minimal anchor
    return [root];
  }

  return intervals.map((i) => ((root + i) % 12) as PitchClass);
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function buildHarmonicContext(
  key: KeyInfo,
  chordSymbol: string | null,
): HarmonicContext {
  const scalePitchClasses = new Set<PitchClass>(buildScale(key.tonic, key.mode));
  const chordTones = chordSymbol ? parseChord(chordSymbol) : [];
  const chordPitchClasses = new Set<PitchClass>(chordTones);

  return { scalePitchClasses, chordPitchClasses };
}

// ---------------------------------------------------------------------------
// Core quantizer
// ---------------------------------------------------------------------------

/**
 * Snap a MIDI note to the nearest note allowed by the harmonic context.
 *
 * Rules:
 * 1. Chord tones pass through unchanged.
 * 2. Scale tones pass through unchanged.
 * 3. Chromatic notes snap to the nearest scale tone (±1–3 semitones).
 *    Ties prefer chord tones, then round down.
 */
export function constrainPitch(
  note: number,
  context: HarmonicContext,
): number {
  const { scalePitchClasses, chordPitchClasses } = context;

  // Empty context = no constraining
  if (scalePitchClasses.size === 0) return note;

  const pc = (note % 12) as PitchClass;

  // Already a chord tone or scale tone — pass through
  if (chordPitchClasses.has(pc) || scalePitchClasses.has(pc)) return note;

  // Search outward for nearest scale tone
  for (let dist = 1; dist <= 6; dist++) {
    const below = ((pc - dist + 12) % 12) as PitchClass;
    const above = ((pc + dist) % 12) as PitchClass;

    const belowInScale = scalePitchClasses.has(below);
    const aboveInScale = scalePitchClasses.has(above);

    if (belowInScale && aboveInScale) {
      // Tie — prefer chord tone, then round down
      const belowIsChord = chordPitchClasses.has(below);
      const aboveIsChord = chordPitchClasses.has(above);

      if (aboveIsChord && !belowIsChord) {
        return clampMidi(note + dist);
      }
      // Default: round down (or below is chord tone)
      return clampMidi(note - dist);
    }

    if (belowInScale) return clampMidi(note - dist);
    if (aboveInScale) return clampMidi(note + dist);
  }

  // Shouldn't reach here with a 7-note scale, but safety fallback
  return note;
}

function clampMidi(n: number): number {
  return Math.max(0, Math.min(127, n));
}
