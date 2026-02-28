/**
 * Zustand store for Conductor UI state.
 *
 * Exposes the Conductor's phase, planning status, and suggestions
 * for the DAW UI to render.
 */

import { create } from "zustand";

export type ConductorPhase =
  | "idle"
  | "drafting"
  | "ready"
  | "performing"
  | "complete";

interface ConductorStore {
  /** Current phase of the conductor lifecycle */
  phase: ConductorPhase;
  /** True while a planSection() call is in flight */
  isPlanning: boolean;
  /** Message from Claude's suggest_to_human tool */
  suggestion: string | null;
  /** Urgency of the current suggestion */
  suggestionUrgency: "info" | "suggestion" | "important";
  /** Error message if something went wrong */
  error: string | null;

  // Actions
  setPhase: (phase: ConductorPhase) => void;
  setPlanning: (planning: boolean) => void;
  setSuggestion: (
    message: string | null,
    urgency?: "info" | "suggestion" | "important"
  ) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useConductorStore = create<ConductorStore>((set) => ({
  phase: "idle",
  isPlanning: false,
  suggestion: null,
  suggestionUrgency: "suggestion",
  error: null,

  setPhase: (phase) => set({ phase }),
  setPlanning: (planning) => set({ isPlanning: planning }),
  setSuggestion: (message, urgency = "suggestion") =>
    set({ suggestion: message, suggestionUrgency: urgency }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      phase: "idle",
      isPlanning: false,
      suggestion: null,
      suggestionUrgency: "suggestion",
      error: null,
    }),
}));
