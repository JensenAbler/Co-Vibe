/**
 * Zustand store for the agent state machine.
 *
 * Simplified for the Conductor-based architecture. The Conductor
 * handles all AI complexity — this store just tracks high-level
 * session state and position for the UI.
 *
 * States:
 * - idle: No session active
 * - generating_draft: Claude generating initial draft arrangement
 * - draft_ready: Draft done, waiting for play
 * - performing: Session is playing, human can record anytime
 * - human_recording: Human actively recording MIDI into a slot
 * - finished: Session complete
 */

import { create } from "zustand";
import type { AgentState, AgentContext } from "@/types/agent";
import type { SongOutline } from "@/types/song-outline";

interface AgentStore extends AgentContext {
  // Actions
  transition: (newState: AgentState) => void;
  setCurrentSection: (index: number) => void;
  setCurrentSlot: (slotId: string | null) => void;
  setCurrentChord: (chord: string | null) => void;
  reset: () => void;

  /** Called by AudioEngine on each beat boundary change */
  tick: (beat: number, position: number, outline: SongOutline) => void;

  /** Start the performance — transitions from draft_ready or idle */
  startPerformance: () => void;

  /** Called when the user starts recording MIDI */
  onRecordingStarted: () => void;

  /** Called when a recording is completed */
  onRecordingCompleted: () => void;
}

const INITIAL_CONTEXT: AgentContext = {
  state: "idle",
  current_section_index: 0,
  current_slot_id: null,
  current_chord: null,
  idle_beats: 0,
};

/**
 * Find which section contains the given position.
 */
function findSectionIndex(
  outline: SongOutline,
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
 * Find the current chord at a given position within a section.
 */
function findChordAtPosition(
  outline: SongOutline,
  sectionIndex: number,
  position: number
): string | null {
  const section = outline.sections[sectionIndex];
  if (!section || section.chords.length === 0) return null;

  for (const chord of section.chords) {
    if (position >= chord.start_time && position < chord.end_time) {
      return chord.chord;
    }
  }
  return section.chords[section.chords.length - 1]?.chord ?? null;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...INITIAL_CONTEXT,

  transition: (newState) => set({ state: newState }),
  setCurrentSection: (index) => set({ current_section_index: index }),
  setCurrentSlot: (slotId) => set({ current_slot_id: slotId }),
  setCurrentChord: (chord) => set({ current_chord: chord }),
  reset: () => set(INITIAL_CONTEXT),

  startPerformance: () => {
    set({
      state: "performing",
      current_section_index: 0,
      idle_beats: 0,
    });
  },

  onRecordingStarted: () => {
    set({ state: "human_recording", idle_beats: 0 });
  },

  onRecordingCompleted: () => {
    set({ state: "performing" });
  },

  tick: (beat, position, outline) => {
    const state = get();

    // Update section and chord tracking regardless of state
    const sectionIndex = findSectionIndex(outline, position);
    const chord = findChordAtPosition(outline, sectionIndex, position);

    if (
      sectionIndex !== state.current_section_index ||
      chord !== state.current_chord
    ) {
      set({
        current_section_index: sectionIndex,
        current_chord: chord,
      });
    }

    // Track idle beats during performance
    if (state.state === "performing") {
      set({ idle_beats: state.idle_beats + 1 });
    }
  },
}));
