/**
 * Simple oscillator-based synthesizer for MIDI playback.
 *
 * Uses triangle wave oscillators with basic attack/release envelope.
 * Handles both live playing (noteOn/noteOff) and scheduled playback
 * of recorded SlotRecording events.
 */

import { midiNoteToFrequency } from "./utils";
import type { SlotRecording } from "@/types/session";

const ATTACK_TIME = 0.01; // 10ms
const RELEASE_TIME = 0.05; // 50ms
const MAX_GAIN = 0.3; // prevent synth from overwhelming stems

interface ActiveNote {
  osc: OscillatorNode;
  gain: GainNode;
}

export class SimpleSynth {
  private ctx: AudioContext;
  private output: AudioNode;
  private activeNotes = new Map<number, ActiveNote>();
  private scheduledNodes: { osc: OscillatorNode; gain: GainNode }[] = [];

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.output = destination;
  }

  /**
   * Start playing a note (live MIDI preview).
   */
  noteOn(note: number, velocity: number): void {
    // Stop any existing note at this pitch to avoid stacking
    this.noteOff(note);

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiNoteToFrequency(note);

    const gain = this.ctx.createGain();
    const targetGain = (velocity / 127) * MAX_GAIN;

    // Attack envelope
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(
      targetGain,
      this.ctx.currentTime + ATTACK_TIME
    );

    osc.connect(gain);
    gain.connect(this.output);
    osc.start(this.ctx.currentTime);

    this.activeNotes.set(note, { osc, gain });
  }

  /**
   * Stop playing a note (live MIDI preview).
   */
  noteOff(note: number): void {
    const active = this.activeNotes.get(note);
    if (!active) return;

    const { osc, gain } = active;
    const now = this.ctx.currentTime;

    // Release envelope
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + RELEASE_TIME);
    osc.stop(now + RELEASE_TIME + 0.01);

    this.activeNotes.delete(note);
  }

  /**
   * Schedule all notes from a SlotRecording for playback.
   * `startTime` is the AudioContext time at which the recording begins.
   */
  scheduleRecording(recording: SlotRecording, startTime: number): void {
    for (const event of recording.midi_events) {
      const noteStart = startTime + event.time;
      const noteEnd = noteStart + event.duration;
      const targetGain = (event.velocity / 127) * MAX_GAIN;

      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiNoteToFrequency(event.note);

      const gain = this.ctx.createGain();
      // Attack
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(targetGain, noteStart + ATTACK_TIME);
      // Sustain until release
      gain.gain.setValueAtTime(targetGain, noteEnd);
      // Release
      gain.gain.linearRampToValueAtTime(0, noteEnd + RELEASE_TIME);

      osc.connect(gain);
      gain.connect(this.output);

      osc.start(noteStart);
      osc.stop(noteEnd + RELEASE_TIME + 0.01);

      this.scheduledNodes.push({ osc, gain });
    }
  }

  /**
   * Schedule a single note for playback at an absolute AudioContext time.
   * Used by the Conductor for per-event scheduling.
   */
  scheduleNote(
    note: number,
    velocity: number,
    startTime: number,
    duration: number
  ): void {
    const noteEnd = startTime + duration;
    const targetGain = (velocity / 127) * MAX_GAIN;

    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiNoteToFrequency(note);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(targetGain, startTime + ATTACK_TIME);
    gain.gain.setValueAtTime(targetGain, noteEnd);
    gain.gain.linearRampToValueAtTime(0, noteEnd + RELEASE_TIME);

    osc.connect(gain);
    gain.connect(this.output);

    osc.start(startTime);
    osc.stop(noteEnd + RELEASE_TIME + 0.01);

    this.scheduledNodes.push({ osc, gain });
  }

  /**
   * Stop all active and scheduled notes.
   */
  stopAll(): void {
    const now = this.ctx.currentTime;

    // Stop live notes
    for (const [note] of this.activeNotes) {
      this.noteOff(note);
    }

    // Stop scheduled notes
    for (const { osc, gain } of this.scheduledNodes) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        osc.stop(now + 0.01);
      } catch {
        // Oscillator may have already stopped
      }
    }

    this.scheduledNodes = [];
    this.activeNotes.clear();
  }

  dispose(): void {
    this.stopAll();
  }
}
