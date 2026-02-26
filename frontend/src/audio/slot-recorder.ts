/**
 * Captures MIDI events during a slot recording session.
 *
 * Pairs Note On/Off events, computes durations, and produces
 * a complete SlotRecording when recording is stopped.
 */

import type { MidiEvent, SlotRecording } from "@/types/session";
import type { SlotTrack } from "@/types/song-outline";
import type { AudioEngine } from "./audio-engine";

interface PendingNote {
  velocity: number;
  startTime: number; // relative to recording start
}

export class SlotRecorder {
  private isRecordingActive = false;
  private currentSlotId: string | null = null;
  private currentTrack: SlotTrack | null = null;
  private events: MidiEvent[] = [];
  private activeNotes = new Map<number, PendingNote>();
  private recordingStartTime = 0;
  private engine: AudioEngine | null = null;

  /**
   * Begin capturing MIDI events for a slot.
   */
  startRecording(
    slotId: string,
    track: SlotTrack,
    audioEngine: AudioEngine
  ): void {
    this.isRecordingActive = true;
    this.currentSlotId = slotId;
    this.currentTrack = track;
    this.events = [];
    this.activeNotes.clear();
    this.engine = audioEngine;
    this.recordingStartTime = audioEngine.getCurrentTime();
  }

  /**
   * Handle a MIDI Note On event.
   */
  handleNoteOn(note: number, velocity: number): void {
    if (!this.isRecordingActive || !this.engine) return;

    const time = this.engine.getCurrentTime() - this.recordingStartTime;
    this.activeNotes.set(note, { velocity, startTime: time });
  }

  /**
   * Handle a MIDI Note Off event.
   */
  handleNoteOff(note: number): void {
    if (!this.isRecordingActive || !this.engine) return;

    const pending = this.activeNotes.get(note);
    if (!pending) return;

    const endTime = this.engine.getCurrentTime() - this.recordingStartTime;
    const duration = endTime - pending.startTime;

    this.events.push({
      note,
      velocity: pending.velocity,
      time: pending.startTime,
      duration: Math.max(duration, 0.01), // minimum 10ms
    });

    this.activeNotes.delete(note);
  }

  /**
   * Stop recording and return the completed SlotRecording.
   * Returns null if no events were captured.
   */
  stopRecording(): SlotRecording | null {
    if (!this.isRecordingActive || !this.currentSlotId || !this.currentTrack) {
      return null;
    }

    // Finalize any held notes
    if (this.engine) {
      const endTime = this.engine.getCurrentTime() - this.recordingStartTime;
      for (const [note, pending] of this.activeNotes) {
        this.events.push({
          note,
          velocity: pending.velocity,
          time: pending.startTime,
          duration: Math.max(endTime - pending.startTime, 0.01),
        });
      }
    }

    this.isRecordingActive = false;
    this.activeNotes.clear();

    if (this.events.length === 0) {
      return null;
    }

    // Sort by time for consistent playback
    this.events.sort((a, b) => a.time - b.time);

    const recording: SlotRecording = {
      slot_id: this.currentSlotId,
      track_name: this.currentTrack,
      source: "user",
      midi_events: [...this.events],
      filled_at: Date.now(),
    };

    this.events = [];
    this.currentSlotId = null;
    this.currentTrack = null;
    this.engine = null;

    return recording;
  }

  isActive(): boolean {
    return this.isRecordingActive;
  }

  getCurrentSlotId(): string | null {
    return this.currentSlotId;
  }
}

// Module-level singleton
let recorderInstance: SlotRecorder | null = null;

export function getSlotRecorder(): SlotRecorder {
  if (!recorderInstance) {
    recorderInstance = new SlotRecorder();
  }
  return recorderInstance;
}
