/**
 * Zustand store for the agent state machine.
 *
 * The agent is a deterministic navigator — it tracks position in the
 * song outline and prompts the user for slot input. During performance
 * it does NOT run AI inference; it's a state machine.
 *
 * The AudioEngine calls `tick()` on every beat boundary change.
 */

import { create } from "zustand";
import type { AgentState, AgentContext } from "@/types/agent";
import type { SongOutline, Slot } from "@/types/song-outline";
import { useSessionStore } from "./session-store";

/** Number of idle beats before the agent auto-fills a slot */
const IDLE_THRESHOLD = 16; // 4 bars at 4/4

/** Number of beats to pause in reviewing state before advancing */
const REVIEW_BEATS = 2;

interface AgentStore extends AgentContext {
  /** Beats spent in reviewing state (for auto-advance) */
  review_beats: number;

  // Actions
  transition: (newState: AgentState) => void;
  setCurrentSection: (index: number) => void;
  setCurrentSlot: (slotId: string | null) => void;
  setCurrentChord: (chord: string | null) => void;
  incrementIdleBeats: () => void;
  resetIdleBeats: () => void;
  reset: () => void;

  /** Called by AudioEngine on each beat boundary change */
  tick: (beat: number, position: number, outline: SongOutline) => void;

  /** Start the performance — transitions from idle */
  startPerformance: (outline: SongOutline) => void;

  /** Called when the user starts recording (MIDI noteOn during prompting) */
  onRecordingStarted: () => void;

  /** Called when a recording is completed */
  onRecordingCompleted: (outline: SongOutline) => void;
}

const INITIAL_CONTEXT: AgentContext & { review_beats: number } = {
  state: "idle",
  current_section_index: 0,
  current_slot_id: null,
  current_chord: null,
  idle_beats: 0,
  review_beats: 0,
};

/**
 * Find the next empty slot sorted by priority.
 */
function getNextEmptySlot(outline: SongOutline): Slot | null {
  const session = useSessionStore.getState();
  const filledSlotIds = new Set(session.recordings.map((r) => r.slot_id));

  const emptySlots = outline.slots.filter(
    (s) => s.status === "empty" && !filledSlotIds.has(s.id)
  );

  if (emptySlots.length === 0) return null;

  // Sort by priority (lower = prompted first)
  emptySlots.sort((a, b) => a.priority - b.priority);
  return emptySlots[0];
}

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
  // Default to the last chord in the section
  return section.chords[section.chords.length - 1]?.chord ?? null;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...INITIAL_CONTEXT,

  transition: (newState) => set({ state: newState }),
  setCurrentSection: (index) => set({ current_section_index: index }),
  setCurrentSlot: (slotId) => set({ current_slot_id: slotId }),
  setCurrentChord: (chord) => set({ current_chord: chord }),
  incrementIdleBeats: () =>
    set((state) => ({ idle_beats: state.idle_beats + 1 })),
  resetIdleBeats: () => set({ idle_beats: 0 }),
  reset: () => set(INITIAL_CONTEXT),

  startPerformance: (outline) => {
    // Check if the song has an intro section
    const hasIntro =
      outline.sections.length > 0 &&
      outline.sections[0].label === "intro";

    if (hasIntro) {
      set({
        state: "playing_intro",
        current_section_index: 0,
        idle_beats: 0,
        review_beats: 0,
      });
    } else {
      // Skip straight to prompting
      const nextSlot = getNextEmptySlot(outline);
      set({
        state: nextSlot ? "prompting" : "completing",
        current_slot_id: nextSlot?.id ?? null,
        current_section_index: 0,
        idle_beats: 0,
        review_beats: 0,
      });
    }
  },

  onRecordingStarted: () => {
    set({ state: "recording", idle_beats: 0 });
  },

  onRecordingCompleted: (outline) => {
    set({ state: "reviewing", review_beats: 0 });

    // Check if all slots are now filled
    const nextSlot = getNextEmptySlot(outline);
    if (!nextSlot) {
      set({ state: "completing", current_slot_id: null });
    }
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

    // State-specific transitions
    switch (state.state) {
      case "playing_intro": {
        // Wait for intro section to end
        const introSection = outline.sections[0];
        if (introSection && position >= introSection.end_time) {
          const nextSlot = getNextEmptySlot(outline);
          set({
            state: nextSlot ? "prompting" : "completing",
            current_slot_id: nextSlot?.id ?? null,
            idle_beats: 0,
          });
        }
        break;
      }

      case "prompting": {
        // Increment idle beats
        set({ idle_beats: state.idle_beats + 1 });

        // If idle too long, agent auto-fills the current slot
        if (state.idle_beats + 1 >= IDLE_THRESHOLD && state.current_slot_id) {
          const slot = outline.slots.find(
            (s) => s.id === state.current_slot_id
          );
          if (slot) {
            // Mark slot as agent-filled (silent placeholder for MVP)
            useSessionStore.getState().updateSlotStatus(slot.id, "agent-filled");
            useSessionStore.getState().addRecording({
              slot_id: slot.id,
              track_name: slot.track_name,
              source: "agent",
              midi_events: [], // silent fill for MVP
              filled_at: Date.now(),
            });

            // Move to next slot or complete
            const nextSlot = getNextEmptySlot(outline);
            set({
              state: nextSlot ? "prompting" : "completing",
              current_slot_id: nextSlot?.id ?? null,
              idle_beats: 0,
            });
          }
        }
        break;
      }

      case "reviewing": {
        // Auto-advance after a few beats
        const newReview = state.review_beats + 1;
        if (newReview >= REVIEW_BEATS) {
          const nextSlot = getNextEmptySlot(outline);
          set({
            state: nextSlot ? "prompting" : "completing",
            current_slot_id: nextSlot?.id ?? null,
            idle_beats: 0,
            review_beats: 0,
          });
        } else {
          set({ review_beats: newReview });
        }
        break;
      }

      case "agent_filling": {
        // MVP: agent fill is handled in the prompting idle timeout above
        // This state exists for future use when agent actually generates MIDI
        break;
      }

      case "completing": {
        // Song is wrapping up, transition to finished when it ends
        // (AudioEngine handles the actual stop + transition to finished)
        break;
      }

      default:
        break;
    }
  },
}));
