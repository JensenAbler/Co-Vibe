/**
 * Executes Claude's tool calls against the app stores and audio engine.
 *
 * Each tool maps to store actions or engine methods.
 * Returns a string result for the tool_result message.
 */

import type { ClaudeToolUseBlock } from "@/types/claude";
import type { MidiEvent, SlotRecording } from "@/types/session";
import type { SlotTrack } from "@/types/song-outline";
import { useSessionStore } from "@/store/session-store";
import { useTransportStore } from "@/store/transport-store";
import { useConductorStore } from "@/store/conductor-store";
import { getAudioEngine } from "@/audio/audio-engine";
import type { PerformanceOutline } from "./performance-outline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolResult {
  content: string;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a single tool call and return the result.
 *
 * @param toolCall - The tool_use block from Claude's response
 * @param outline - The performance outline for context
 * @param source - Recording source tag ("agent-draft" | "agent")
 */
export function executeTool(
  toolCall: ClaudeToolUseBlock,
  outline: PerformanceOutline,
  source: "agent-draft" | "agent" = "agent"
): ToolResult {
  const { name, input } = toolCall;

  try {
    switch (name) {
      case "generate_midi":
        return executeGenerateMidi(input, outline, source);
      case "clear_slot":
        return executeClearSlot(input);
      case "set_track_volume":
        return executeSetTrackVolume(input);
      case "mute_track":
        return executeMuteTrack(input);
      case "solo_track":
        return executeSoloTrack(input);
      case "set_stem_volume":
        return executeSetStemVolume(input);
      case "mute_stem":
        return executeMuteStem(input);
      case "suggest_to_human":
        return executeSuggestToHuman(input);
      case "get_session_state":
        return executeGetSessionState(outline);
      case "get_section_details":
        return executeGetSectionDetails(input, outline);
      default:
        return { content: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (err) {
    return {
      content: `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`,
      is_error: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function executeGenerateMidi(
  input: Record<string, unknown>,
  outline: PerformanceOutline,
  source: "agent-draft" | "agent"
): ToolResult {
  const slotId = input.slot_id as string;
  const events = input.events as Array<{
    note: number;
    velocity: number;
    time: number;
    duration: number;
  }>;

  if (!slotId || !events) {
    return { content: "Missing slot_id or events", is_error: true };
  }

  // Find the slot in the performance outline
  const slot = outline.slots.find((s) => s.id === slotId);
  if (!slot) {
    return { content: `Slot not found: ${slotId}`, is_error: true };
  }

  // Find the performance section for time offset calculation
  const section = outline.sections.find((s) => s.id === slot.sectionId);
  if (!section) {
    return { content: `Section not found for slot: ${slotId}`, is_error: true };
  }

  // Convert events: times are relative to section start,
  // but we store them as absolute times in the performance timeline
  const midiEvents: MidiEvent[] = events.map((e) => ({
    note: e.note,
    velocity: e.velocity,
    time: section.start_time + e.time,
    duration: e.duration,
  }));

  const recording: SlotRecording = {
    slot_id: slotId,
    track_name: slot.track as SlotTrack,
    source: source === "agent-draft" ? "agent" : "agent",
    midi_events: midiEvents,
    filled_at: Date.now(),
  };

  // Store with metadata about whether it's a draft
  const sessionStore = useSessionStore.getState();
  sessionStore.addRecording(recording);

  return {
    content: `Generated ${events.length} MIDI events for ${slot.track} in ${slot.sectionId}`,
  };
}

function executeClearSlot(input: Record<string, unknown>): ToolResult {
  const slotId = input.slot_id as string;
  if (!slotId) {
    return { content: "Missing slot_id", is_error: true };
  }

  const sessionStore = useSessionStore.getState();
  sessionStore.removeRecording(slotId);

  return { content: `Cleared slot: ${slotId}` };
}

function executeSetTrackVolume(input: Record<string, unknown>): ToolResult {
  const trackName = input.track_name as string;
  const volume = input.volume as number;

  if (!trackName || volume === undefined) {
    return { content: "Missing track_name or volume", is_error: true };
  }

  useTransportStore.getState().setVolume(trackName, volume);
  return { content: `Set ${trackName} volume to ${volume}` };
}

function executeMuteTrack(input: Record<string, unknown>): ToolResult {
  const trackName = input.track_name as string;
  const muted = input.muted as boolean;

  if (!trackName || muted === undefined) {
    return { content: "Missing track_name or muted", is_error: true };
  }

  const transportStore = useTransportStore.getState();
  const currentlyMuted = transportStore.mutedTracks.has(trackName);
  if (currentlyMuted !== muted) {
    transportStore.toggleMute(trackName);
  }

  return { content: `${muted ? "Muted" : "Unmuted"} track: ${trackName}` };
}

function executeSoloTrack(input: Record<string, unknown>): ToolResult {
  const trackName = input.track_name as string;
  const soloed = input.soloed as boolean;

  if (!trackName || soloed === undefined) {
    return { content: "Missing track_name or soloed", is_error: true };
  }

  const transportStore = useTransportStore.getState();
  const currentlySoloed = transportStore.soloedTracks.has(trackName);
  if (currentlySoloed !== soloed) {
    transportStore.toggleSolo(trackName);
  }

  return { content: `${soloed ? "Soloed" : "Unsoloed"} track: ${trackName}` };
}

function executeSetStemVolume(input: Record<string, unknown>): ToolResult {
  const stemName = input.stem_name as string;
  const volume = input.volume as number;

  if (!stemName || volume === undefined) {
    return { content: "Missing stem_name or volume", is_error: true };
  }

  const engine = getAudioEngine();
  engine.setVolume(stemName, volume);

  return { content: `Set stem ${stemName} volume to ${volume}` };
}

function executeMuteStem(input: Record<string, unknown>): ToolResult {
  const stemName = input.stem_name as string;
  const muted = input.muted as boolean;

  if (!stemName || muted === undefined) {
    return { content: "Missing stem_name or muted", is_error: true };
  }

  const engine = getAudioEngine();
  engine.setMute(stemName, muted);

  // Update the transport store to reflect the change
  const transportStore = useTransportStore.getState();
  const currentlyMuted = transportStore.mutedTracks.has(stemName);
  if (currentlyMuted !== muted) {
    transportStore.toggleMute(stemName);
  }

  return { content: `${muted ? "Muted" : "Unmuted"} stem: ${stemName}` };
}

function executeSuggestToHuman(input: Record<string, unknown>): ToolResult {
  const message = input.message as string;
  const urgency = (input.urgency as string) ?? "suggestion";

  if (!message) {
    return { content: "Missing message", is_error: true };
  }

  useConductorStore.getState().setSuggestion(
    message,
    urgency as "info" | "suggestion" | "important"
  );

  return { content: `Suggestion displayed: "${message}"` };
}

function executeGetSessionState(outline: PerformanceOutline): ToolResult {
  const sessionStore = useSessionStore.getState();
  const transportStore = useTransportStore.getState();

  const slotStates = outline.slots.map((slot) => {
    const recording = sessionStore.recordings.find(
      (r) => r.slot_id === slot.id
    );
    return {
      slot_id: slot.id,
      track: slot.track,
      section_id: slot.sectionId,
      source: recording?.source ?? null,
      event_count: recording?.midi_events.length ?? 0,
    };
  });

  const state = {
    slots: slotStates,
    muted_tracks: Array.from(transportStore.mutedTracks),
    soloed_tracks: Array.from(transportStore.soloedTracks),
  };

  return { content: JSON.stringify(state, null, 2) };
}

function executeGetSectionDetails(
  input: Record<string, unknown>,
  outline: PerformanceOutline
): ToolResult {
  const sectionId = input.section_id as string;
  if (!sectionId) {
    return { content: "Missing section_id", is_error: true };
  }

  const section = outline.sections.find((s) => s.id === sectionId);
  if (!section) {
    return { content: `Section not found: ${sectionId}`, is_error: true };
  }

  const sessionStore = useSessionStore.getState();
  const sectionSlots = outline.slots
    .filter((s) => s.sectionId === sectionId)
    .map((slot) => {
      const recording = sessionStore.recordings.find(
        (r) => r.slot_id === slot.id
      );
      return {
        slot_id: slot.id,
        track: slot.track,
        source: recording?.source ?? null,
        event_count: recording?.midi_events.length ?? 0,
      };
    });

  const details = {
    id: section.id,
    label: section.label,
    start_time: section.start_time,
    end_time: section.end_time,
    midpoint: section.midpoint,
    chords: section.chords.map((c) => ({
      chord: c.chord,
      start_time: c.start_time,
      end_time: c.end_time,
    })),
    slots: sectionSlots,
  };

  return { content: JSON.stringify(details, null, 2) };
}
