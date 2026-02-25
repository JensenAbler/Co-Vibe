/**
 * Zustand store for the current session state.
 *
 * Holds the song outline, slot recordings, and provides actions
 * for filling slots and updating status.
 */

import { create } from "zustand";
import type { SongOutline, Slot, SlotStatus } from "@/types/song-outline";
import type { SlotRecording } from "@/types/session";

interface SessionState {
  /** The analyzed song outline, null before analysis completes */
  outline: SongOutline | null;
  /** Per-slot recordings (user or agent) */
  recordings: SlotRecording[];

  // Actions
  setOutline: (outline: SongOutline) => void;
  updateSlotStatus: (slotId: string, status: SlotStatus) => void;
  addRecording: (recording: SlotRecording) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  outline: null,
  recordings: [],

  setOutline: (outline) => set({ outline }),

  updateSlotStatus: (slotId, status) =>
    set((state) => {
      if (!state.outline) return state;
      return {
        outline: {
          ...state.outline,
          slots: state.outline.slots.map((slot: Slot) =>
            slot.id === slotId ? { ...slot, status } : slot
          ),
        },
      };
    }),

  addRecording: (recording) =>
    set((state) => ({
      recordings: [...state.recordings, recording],
    })),

  reset: () => set({ outline: null, recordings: [] }),
}));
