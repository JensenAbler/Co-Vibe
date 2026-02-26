/**
 * Zustand store for transport (playback) state.
 *
 * The playhead position is updated at ~60fps via requestAnimationFrame
 * and should be read via selectors to avoid unnecessary re-renders.
 */

import { create } from "zustand";
import { getAudioEngine } from "@/audio/audio-engine";

interface TransportState {
  isPlaying: boolean;
  /** Current playback position in seconds */
  position: number;
  /** Current beat index */
  currentBeat: number;
  /** Track names that are muted */
  mutedTracks: Set<string>;
  /** Track names that are solo'd */
  soloedTracks: Set<string>;
  /** Whether stems have been loaded */
  stemsReady: boolean;
  /** Per-track volume levels (0-1) */
  trackVolumes: Record<string, number>;

  // Actions
  play: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setPosition: (position: number) => void;
  setCurrentBeat: (beat: number) => void;
  toggleMute: (trackName: string) => void;
  toggleSolo: (trackName: string) => void;
  setVolume: (trackName: string, volume: number) => void;
  setStemsReady: (ready: boolean) => void;
}

export const useTransportStore = create<TransportState>((set, get) => ({
  isPlaying: false,
  position: 0,
  currentBeat: 0,
  mutedTracks: new Set<string>(),
  soloedTracks: new Set<string>(),
  stemsReady: false,
  trackVolumes: {},

  play: () => {
    const engine = getAudioEngine();
    engine.play();
    set({ isPlaying: true });
  },

  stop: () => {
    const engine = getAudioEngine();
    engine.stop();
    set({ isPlaying: false, position: 0, currentBeat: 0 });
  },

  setPosition: (position) => set({ position }),
  setCurrentBeat: (beat) => set({ currentBeat: beat }),

  toggleMute: (trackName) => {
    const { mutedTracks } = get();
    const next = new Set(mutedTracks);
    const engine = getAudioEngine();

    if (next.has(trackName)) {
      next.delete(trackName);
      engine.setMute(trackName, false);
    } else {
      next.add(trackName);
      engine.setMute(trackName, true);
    }
    set({ mutedTracks: next });
  },

  toggleSolo: (trackName) => {
    const { soloedTracks } = get();
    const next = new Set(soloedTracks);
    const engine = getAudioEngine();

    if (next.has(trackName)) {
      next.delete(trackName);
      engine.setSolo(trackName, false);
    } else {
      next.add(trackName);
      engine.setSolo(trackName, true);
    }
    set({ soloedTracks: next });
  },

  seek: (time) => {
    const engine = getAudioEngine();
    engine.seek(time);
  },

  setVolume: (trackName, volume) => {
    const { trackVolumes } = get();
    const engine = getAudioEngine();
    engine.setVolume(trackName, volume);
    set({ trackVolumes: { ...trackVolumes, [trackName]: volume } });
  },

  setStemsReady: (ready) => set({ stemsReady: ready }),
}));
