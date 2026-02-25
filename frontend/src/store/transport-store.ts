/**
 * Zustand store for transport (playback) state.
 *
 * The playhead position is updated at ~60fps via requestAnimationFrame
 * and should be read via selectors to avoid unnecessary re-renders.
 */

import { create } from "zustand";

interface TransportState {
  isPlaying: boolean;
  /** Current playback position in seconds */
  position: number;
  /** Current beat index */
  currentBeat: number;

  // Actions
  play: () => void;
  stop: () => void;
  setPosition: (position: number) => void;
  setCurrentBeat: (beat: number) => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  isPlaying: false,
  position: 0,
  currentBeat: 0,

  play: () => set({ isPlaying: true }),
  stop: () => set({ isPlaying: false, position: 0, currentBeat: 0 }),
  setPosition: (position) => set({ position }),
  setCurrentBeat: (beat) => set({ currentBeat: beat }),
}));
