/**
 * Chord-aware carrier frequency driver for the vocoder.
 *
 * Subscribes to the agent store's current_chord and updates the vocoder's
 * carrier oscillator frequency to match the chord root in octave 3.
 */

import { useAgentStore } from "@/store/agent-store";
import { parseChord } from "./pitch-constrainer";
import { midiNoteToFrequency } from "./utils";
import type { Vocoder } from "./vocoder";

/** Octave for the carrier root. 3 = C3..B3 (MIDI 48-59). */
const CARRIER_OCTAVE = 3;

export class CarrierSynth {
  private vocoder: Vocoder;
  private unsubscribe: (() => void) | null = null;
  private lastChord: string | null = null;

  constructor(vocoder: Vocoder) {
    this.vocoder = vocoder;
  }

  /** Subscribe to agent store chord changes. */
  start(): void {
    // Set initial chord if available
    const initial = useAgentStore.getState().current_chord;
    if (initial) this.setChord(initial);

    this.unsubscribe = useAgentStore.subscribe((state) => {
      if (state.current_chord !== this.lastChord) {
        this.setChord(state.current_chord);
      }
    });
  }

  /** Stop listening to chord changes. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Update the carrier frequency from a chord symbol. */
  setChord(chordSymbol: string | null): void {
    this.lastChord = chordSymbol;
    if (!chordSymbol) return;

    const pitchClasses = parseChord(chordSymbol);
    if (pitchClasses.length === 0) return;

    // Root is the first pitch class returned by parseChord
    const rootPc = pitchClasses[0];
    const midiNote = rootPc + (CARRIER_OCTAVE + 1) * 12; // C3 = 48
    const freq = midiNoteToFrequency(midiNote);

    this.vocoder.setCarrierFrequency(freq);
  }

  dispose(): void {
    this.stop();
  }
}
