/**
 * Transforms a SongOutline into a PerformanceOutline.
 *
 * Each original section becomes a performance section at 2x duration.
 * Chords, beats, and downbeats are duplicated (original + looped copy).
 * Per-section slots are generated (one per track per performance section).
 */

import type {
  SongOutline,
  Section,
  ChordEvent,
  SectionLabel,
  SlotTrack,
} from "@/types/song-outline";

// ---------------------------------------------------------------------------
// Performance types
// ---------------------------------------------------------------------------

export interface PerformanceSection {
  id: string;
  /** Links back to the original analysis section */
  originalSectionId: string;
  label: SectionLabel;
  /** Start time in the performance timeline (seconds) */
  start_time: number;
  /** End time in the performance timeline (seconds) */
  end_time: number;
  /** Midpoint where the chord progression loops (seconds) */
  midpoint: number;
  /** Doubled chords: original chords + repeated with offset */
  chords: ChordEvent[];
}

export interface PerformanceSlot {
  id: string;
  track: SlotTrack;
  sectionId: string;
  /** "empty" | "agent-draft" | "agent" | "user" */
  source: string | null;
}

export interface PerformanceOutline {
  original: SongOutline;
  sections: PerformanceSection[];
  slots: PerformanceSlot[];
  totalDuration: number;
  /** All beats in the performance timeline (original + looped) */
  beats: number[];
  /** All downbeats in the performance timeline (original + looped) */
  downbeats: number[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLOT_TRACKS: SlotTrack[] = ["melody", "bass", "chords", "drums", "pad"];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a PerformanceOutline from an analysis SongOutline.
 *
 * Each original section gets doubled in duration. The chord progression,
 * beats, and downbeats repeat at the midpoint of each doubled section.
 */
export function buildPerformanceOutline(
  outline: SongOutline
): PerformanceOutline {
  const perfSections: PerformanceSection[] = [];
  const perfSlots: PerformanceSlot[] = [];
  const allBeats: number[] = [];
  const allDownbeats: number[] = [];

  let perfTime = 0;

  for (const section of outline.sections) {
    const originalDuration = section.end_time - section.start_time;
    const perfDuration = originalDuration * 2;
    const perfStart = perfTime;
    const perfMid = perfTime + originalDuration;
    const perfEnd = perfTime + perfDuration;

    const perfSectionId = `perf_${section.id}`;

    // Duplicate chords: original at relative offsets, then repeated
    const chords = doubleChords(section.chords, section.start_time, perfStart, originalDuration);

    perfSections.push({
      id: perfSectionId,
      originalSectionId: section.id,
      label: section.label,
      start_time: perfStart,
      end_time: perfEnd,
      midpoint: perfMid,
      chords,
    });

    // Create per-section slots (one per track)
    for (const track of SLOT_TRACKS) {
      perfSlots.push({
        id: `${track}_${perfSectionId}`,
        track,
        sectionId: perfSectionId,
        source: null,
      });
    }

    // Duplicate beats that fall within this original section
    const sectionBeats = outline.beats.filter(
      (b) => b >= section.start_time && b < section.end_time
    );
    for (const beat of sectionBeats) {
      const relativeTime = beat - section.start_time;
      allBeats.push(perfStart + relativeTime);
      allBeats.push(perfMid + relativeTime);
    }

    // Duplicate downbeats
    const sectionDownbeats = outline.downbeats.filter(
      (b) => b >= section.start_time && b < section.end_time
    );
    for (const db of sectionDownbeats) {
      const relativeTime = db - section.start_time;
      allDownbeats.push(perfStart + relativeTime);
      allDownbeats.push(perfMid + relativeTime);
    }

    perfTime = perfEnd;
  }

  // Sort beats/downbeats (they may interleave from different sections)
  allBeats.sort((a, b) => a - b);
  allDownbeats.sort((a, b) => a - b);

  return {
    original: outline,
    sections: perfSections,
    slots: perfSlots,
    totalDuration: perfTime,
    beats: allBeats,
    downbeats: allDownbeats,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Double a section's chord events into the performance timeline.
 *
 * Takes the original chords, maps them to the performance start offset,
 * then duplicates them at the midpoint (where the progression loops).
 */
function doubleChords(
  chords: ChordEvent[],
  originalSectionStart: number,
  perfSectionStart: number,
  originalDuration: number
): ChordEvent[] {
  const result: ChordEvent[] = [];

  for (const chord of chords) {
    const relStart = chord.start_time - originalSectionStart;
    const relEnd = chord.end_time - originalSectionStart;
    const relStartBeat = chord.start_beat;
    const relEndBeat = chord.end_beat;

    // First pass: original position in performance timeline
    result.push({
      chord: chord.chord,
      start_time: perfSectionStart + relStart,
      end_time: perfSectionStart + relEnd,
      start_beat: relStartBeat,
      end_beat: relEndBeat,
    });

    // Second pass: looped at midpoint
    result.push({
      chord: chord.chord,
      start_time: perfSectionStart + originalDuration + relStart,
      end_time: perfSectionStart + originalDuration + relEnd,
      start_beat: relStartBeat,
      end_beat: relEndBeat,
    });
  }

  // Sort by start time
  result.sort((a, b) => a.start_time - b.start_time);

  return result;
}

/**
 * Find the performance section containing a given position.
 */
export function findPerformanceSection(
  outline: PerformanceOutline,
  position: number
): PerformanceSection | null {
  for (const section of outline.sections) {
    if (position >= section.start_time && position < section.end_time) {
      return section;
    }
  }
  return null;
}

/**
 * Find the performance section index containing a given position.
 */
export function findPerformanceSectionIndex(
  outline: PerformanceOutline,
  position: number
): number {
  for (let i = 0; i < outline.sections.length; i++) {
    const s = outline.sections[i];
    if (position >= s.start_time && position < s.end_time) {
      return i;
    }
  }
  return outline.sections.length - 1;
}

/**
 * Get all slots for a given performance section.
 */
export function getSlotsForSection(
  outline: PerformanceOutline,
  sectionId: string
): PerformanceSlot[] {
  return outline.slots.filter((s) => s.sectionId === sectionId);
}
