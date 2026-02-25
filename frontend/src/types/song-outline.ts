/**
 * TypeScript types for the Song Outline — mirrors the Python Pydantic schemas
 * and the shared JSON Schema exactly.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type SectionLabel =
  | "intro"
  | "verse"
  | "chorus"
  | "bridge"
  | "instrumental"
  | "solo"
  | "outro"
  | "break";

export type SlotTrack = "melody" | "bass" | "chords" | "drums" | "pad";

export type SlotStatus = "empty" | "user-filled" | "agent-filled";

// ---------------------------------------------------------------------------
// Sub-types
// ---------------------------------------------------------------------------

export interface KeyInfo {
  tonic: string;
  mode: "major" | "minor";
  confidence: number;
}

export interface TempoInfo {
  bpm: number;
  confidence: number;
}

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface ChordEvent {
  chord: string;
  start_time: number;
  end_time: number;
  start_beat: number;
  end_beat: number;
}

export interface Section {
  id: string;
  label: SectionLabel;
  start_time: number;
  end_time: number;
  start_beat: number;
  end_beat: number;
  chords: ChordEvent[];
}

export interface Slot {
  id: string;
  track_name: SlotTrack;
  section_ids: string[];
  status: SlotStatus;
  priority: number;
}

export interface StemPaths {
  vocals: string;
  drums: string;
  bass: string;
  other: string;
}

export interface SourceTrackInfo {
  filename: string;
  duration: number;
  sample_rate: number;
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export interface SongOutline {
  id: string;
  source_track: SourceTrackInfo;
  key: KeyInfo;
  tempo: TempoInfo;
  time_signature: TimeSignature;
  beats: number[];
  downbeats: number[];
  sections: Section[];
  slots: Slot[];
  stems: StemPaths;
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

export type AnalysisJobStatus =
  | "queued"
  | "separating"
  | "analyzing"
  | "assembling"
  | "complete"
  | "failed";

export interface AnalysisStatus {
  job_id: string;
  status: AnalysisJobStatus;
  progress: number;
  error: string | null;
}

export interface AnalysisResult {
  job_id: string;
  outline: SongOutline;
}
