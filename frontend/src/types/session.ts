/**
 * Session types for persistence and replay.
 */

import type { SongOutline, SlotTrack } from "./song-outline";

export interface MidiEvent {
  note: number;
  velocity: number;
  /** Time relative to transport start, in seconds */
  time: number;
  /** Duration in seconds */
  duration: number;
}

export interface SlotRecording {
  slot_id: string;
  track_name: SlotTrack;
  source: "user" | "agent" | "agent-draft";
  midi_events: MidiEvent[];
  /** Timestamp when this slot was filled */
  filled_at: number;
}

export interface TransportEvent {
  type: "play" | "stop" | "mute" | "solo" | "unmute" | "unsolo";
  track_name?: SlotTrack;
  time: number;
}

export interface Session {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  outline: SongOutline;
  recordings: SlotRecording[];
  transport_events: TransportEvent[];
}
