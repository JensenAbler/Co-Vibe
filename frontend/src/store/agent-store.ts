/**
 * Zustand store for the agent state machine.
 *
 * The agent is a deterministic navigator — it tracks position in the
 * song outline and prompts the user for slot input. During performance
 * it does NOT run AI inference; it's a state machine.
 */

import { create } from "zustand";
import type { AgentState, AgentContext } from "@/types/agent";

interface AgentStore extends AgentContext {
  // Actions
  transition: (newState: AgentState) => void;
  setCurrentSection: (index: number) => void;
  setCurrentSlot: (slotId: string | null) => void;
  setCurrentChord: (chord: string | null) => void;
  incrementIdleBeats: () => void;
  resetIdleBeats: () => void;
  reset: () => void;
}

const INITIAL_CONTEXT: AgentContext = {
  state: "idle",
  current_section_index: 0,
  current_slot_id: null,
  current_chord: null,
  idle_beats: 0,
};

export const useAgentStore = create<AgentStore>((set) => ({
  ...INITIAL_CONTEXT,

  transition: (newState) => set({ state: newState }),
  setCurrentSection: (index) => set({ current_section_index: index }),
  setCurrentSlot: (slotId) => set({ current_slot_id: slotId }),
  setCurrentChord: (chord) => set({ current_chord: chord }),
  incrementIdleBeats: () =>
    set((state) => ({ idle_beats: state.idle_beats + 1 })),
  resetIdleBeats: () => set({ idle_beats: 0 }),
  reset: () => set(INITIAL_CONTEXT),
}));
