/**
 * "Blind MCP" tool definitions for the Conductor.
 *
 * These 10 tools mirror the frontend's CONDUCTOR_TOOLS but follow the
 * "Blind MCP" pattern:
 *
 * - **Action tools** (generate_midi, clear_slot, set_track_volume, mute_track,
 *   solo_track, set_stem_volume, mute_stem, suggest_to_human):
 *   Record the call args in a shared array and return acknowledgment text.
 *   Actual execution happens browser-side when the frontend receives the response.
 *
 * - **Query tools** (get_session_state, get_section_details):
 *   Return pre-sent client state from the request context.
 *   No browser access needed — the frontend sends state with each request.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A recorded tool call to be returned to the frontend for execution. */
export interface RecordedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Session state sent from the frontend with each request. */
export interface ClientSessionState {
  slots: Array<{
    slot_id: string;
    track: string;
    section_id: string;
    source: string | null;
    event_count: number;
  }>;
  muted_tracks: string[];
  soloed_tracks: string[];
  muted_stems: string[];
  active_stem: string | null;
  /** Section details keyed by section ID (for get_section_details) */
  sections: Array<{
    id: string;
    label: string;
    start_time: number;
    end_time: number;
    midpoint: number;
    chords: Array<{
      chord: string;
      start_time: number;
      end_time: number;
    }>;
    slots: Array<{
      slot_id: string;
      track: string;
      source: string | null;
      event_count: number;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Tool call recorder (shared mutable state per request)
// ---------------------------------------------------------------------------

/**
 * Create a fresh set of MCP tools bound to a request-scoped recorder.
 *
 * Each HTTP request creates its own recorder so tool calls don't leak
 * between concurrent requests.
 */
export function createConductorTools(sessionState: ClientSessionState) {
  const recorded: RecordedToolCall[] = [];

  // Helper to record an action call
  function record(name: string, args: Record<string, unknown>): string {
    recorded.push({ name, args });
    return `Queued ${name} for execution.`;
  }

  // -----------------------------------------------------------------------
  // Action tools (record calls, don't execute)
  // -----------------------------------------------------------------------

  const generateMidi = tool(
    "generate_midi",
    "Create MIDI events for a specific slot (one track in one performance section). " +
      "Each event has note (0-127, middle C = 60), velocity (0-127), time (seconds from section start), " +
      "and duration (seconds). For drums, use General MIDI drum map (kick=36, snare=38, hihat=42, etc.).",
    {
      slot_id: z
        .string()
        .describe(
          'The slot ID in the format "{track}_perf_{sectionId}" (e.g. "melody_perf_verse_1").'
        ),
      events: z
        .array(
          z.object({
            note: z.number().describe("MIDI note number 0-127"),
            velocity: z.number().describe("Velocity 0-127"),
            time: z
              .number()
              .describe(
                "Time in seconds from the start of the performance section"
              ),
            duration: z.number().describe("Duration in seconds"),
          })
        )
        .describe("Array of MIDI note events for this slot."),
    },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: record("generate_midi", args),
        },
      ],
    })
  );

  const clearSlot = tool(
    "clear_slot",
    "Remove all content from a slot, resetting it to empty. " +
      "Use this to clear a previous draft or agent contribution before replacing it.",
    {
      slot_id: z.string().describe("The slot ID to clear."),
    },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: record("clear_slot", args),
        },
      ],
    })
  );

  const setTrackVolume = tool(
    "set_track_volume",
    "Set the volume of a synth track (melody, bass, chords, drums, pad). Range 0.0 to 1.0.",
    {
      track_name: z
        .enum(["melody", "bass", "chords", "drums", "pad"])
        .describe("The synth track name."),
      volume: z
        .number()
        .describe("Volume level from 0.0 (silent) to 1.0 (full)."),
    },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: record("set_track_volume", args),
        },
      ],
    })
  );

  const muteTrack = tool(
    "mute_track",
    "Mute or unmute a synth track.",
    {
      track_name: z
        .enum(["melody", "bass", "chords", "drums", "pad"])
        .describe("The synth track name."),
      muted: z.boolean().describe("True to mute, false to unmute."),
    },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: record("mute_track", args),
        },
      ],
    })
  );

  const soloTrack = tool(
    "solo_track",
    "Solo or unsolo a synth track.",
    {
      track_name: z
        .enum(["melody", "bass", "chords", "drums", "pad"])
        .describe("The synth track name."),
      soloed: z.boolean().describe("True to solo, false to unsolo."),
    },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: record("solo_track", args),
        },
      ],
    })
  );

  const setStemVolume = tool(
    "set_stem_volume",
    "Set the volume of an original stem (vocals, drums, bass, other). " +
      "Range 0.0 to 1.0. Remember: max 1 original stem should be audible at a time.",
    {
      stem_name: z
        .enum(["vocals", "drums", "bass", "other"])
        .describe("The original stem name."),
      volume: z
        .number()
        .describe("Volume level from 0.0 (silent) to 1.0 (full)."),
    },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: record("set_stem_volume", args),
        },
      ],
    })
  );

  const muteStem = tool(
    "mute_stem",
    "Mute or unmute an original stem. " +
      "Remember: max 1 original stem should be audible at a time — " +
      "mute other stems when unmuting one.",
    {
      stem_name: z
        .enum(["vocals", "drums", "bass", "other"])
        .describe("The original stem name."),
      muted: z.boolean().describe("True to mute, false to unmute."),
    },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: record("mute_stem", args),
        },
      ],
    })
  );

  const suggestToHuman = tool(
    "suggest_to_human",
    "Display a short message or suggestion to the human performer. " +
      "Use this to suggest what to play, give musical direction, or communicate intent.",
    {
      message: z
        .string()
        .describe(
          "The suggestion or message to display (keep it brief, 1-2 sentences)."
        ),
      urgency: z
        .enum(["info", "suggestion", "important"])
        .default("suggestion")
        .describe('How prominently to display the message. Default "suggestion".'),
    },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: record("suggest_to_human", args),
        },
      ],
    })
  );

  // -----------------------------------------------------------------------
  // Query tools (return pre-sent client state)
  // -----------------------------------------------------------------------

  const getSessionState = tool(
    "get_session_state",
    "Get the current state of the entire session: which slots are filled, " +
      "by whom, what stems are active, and current mix levels.",
    {},
    async () => {
      const state = {
        slots: sessionState.slots,
        muted_tracks: sessionState.muted_tracks,
        soloed_tracks: sessionState.soloed_tracks,
        muted_stems: sessionState.muted_stems,
        active_stem: sessionState.active_stem,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(state, null, 2),
          },
        ],
      };
    }
  );

  const getSectionDetails = tool(
    "get_section_details",
    "Get detailed information about a specific performance section: " +
      "chord progression, slot states, and timing.",
    {
      section_id: z
        .string()
        .describe('The performance section ID (e.g. "perf_verse_1").'),
    },
    async (args) => {
      const section = sessionState.sections.find(
        (s) => s.id === args.section_id
      );
      if (!section) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Section not found: ${args.section_id}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(section, null, 2),
          },
        ],
      };
    }
  );

  return {
    tools: [
      generateMidi,
      clearSlot,
      setTrackVolume,
      muteTrack,
      soloTrack,
      setStemVolume,
      muteStem,
      suggestToHuman,
      getSessionState,
      getSectionDetails,
    ],
    getRecordedCalls: () => [...recorded],
    clearRecordedCalls: () => {
      recorded.length = 0;
    },
  };
}
