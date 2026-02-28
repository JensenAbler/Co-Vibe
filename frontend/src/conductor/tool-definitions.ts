/**
 * Claude tool definitions for the Conductor.
 *
 * These 10 tools give Claude the same capabilities as the human performer:
 * generate MIDI, manage slots, control mix, and communicate.
 */

import type { ClaudeToolDefinition } from "@/types/claude";

export const CONDUCTOR_TOOLS: ClaudeToolDefinition[] = [
  // -----------------------------------------------------------------------
  // MIDI & Slot management
  // -----------------------------------------------------------------------
  {
    name: "generate_midi",
    description:
      "Create MIDI events for a specific slot (one track in one performance section). " +
      "Each event has note (0-127, middle C = 60), velocity (0-127), time (seconds from section start), " +
      "and duration (seconds). For drums, use General MIDI drum map (kick=36, snare=38, hihat=42, etc.).",
    input_schema: {
      type: "object",
      properties: {
        slot_id: {
          type: "string",
          description:
            'The slot ID in the format "{track}_perf_{sectionId}" (e.g. "melody_perf_verse_1").',
        },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              note: { type: "number", description: "MIDI note number 0-127" },
              velocity: { type: "number", description: "Velocity 0-127" },
              time: {
                type: "number",
                description: "Time in seconds from the start of the performance section",
              },
              duration: {
                type: "number",
                description: "Duration in seconds",
              },
            },
            required: ["note", "velocity", "time", "duration"],
          },
          description: "Array of MIDI note events for this slot.",
        },
      },
      required: ["slot_id", "events"],
    },
  },

  {
    name: "clear_slot",
    description:
      "Remove all content from a slot, resetting it to empty. " +
      "Use this to clear a previous draft or agent contribution before replacing it.",
    input_schema: {
      type: "object",
      properties: {
        slot_id: {
          type: "string",
          description: "The slot ID to clear.",
        },
      },
      required: ["slot_id"],
    },
  },

  // -----------------------------------------------------------------------
  // Synth track mix controls
  // -----------------------------------------------------------------------
  {
    name: "set_track_volume",
    description:
      "Set the volume of a synth track (melody, bass, chords, drums, pad). Range 0.0 to 1.0.",
    input_schema: {
      type: "object",
      properties: {
        track_name: {
          type: "string",
          enum: ["melody", "bass", "chords", "drums", "pad"],
          description: "The synth track name.",
        },
        volume: {
          type: "number",
          description: "Volume level from 0.0 (silent) to 1.0 (full).",
        },
      },
      required: ["track_name", "volume"],
    },
  },

  {
    name: "mute_track",
    description: "Mute or unmute a synth track.",
    input_schema: {
      type: "object",
      properties: {
        track_name: {
          type: "string",
          enum: ["melody", "bass", "chords", "drums", "pad"],
          description: "The synth track name.",
        },
        muted: {
          type: "boolean",
          description: "True to mute, false to unmute.",
        },
      },
      required: ["track_name", "muted"],
    },
  },

  {
    name: "solo_track",
    description: "Solo or unsolo a synth track.",
    input_schema: {
      type: "object",
      properties: {
        track_name: {
          type: "string",
          enum: ["melody", "bass", "chords", "drums", "pad"],
          description: "The synth track name.",
        },
        soloed: {
          type: "boolean",
          description: "True to solo, false to unsolo.",
        },
      },
      required: ["track_name", "soloed"],
    },
  },

  // -----------------------------------------------------------------------
  // Original stem controls
  // -----------------------------------------------------------------------
  {
    name: "set_stem_volume",
    description:
      "Set the volume of an original stem (vocals, drums, bass, other). " +
      "Range 0.0 to 1.0. Remember: max 1 original stem should be audible at a time.",
    input_schema: {
      type: "object",
      properties: {
        stem_name: {
          type: "string",
          enum: ["vocals", "drums", "bass", "other"],
          description: "The original stem name.",
        },
        volume: {
          type: "number",
          description: "Volume level from 0.0 (silent) to 1.0 (full).",
        },
      },
      required: ["stem_name", "volume"],
    },
  },

  {
    name: "mute_stem",
    description:
      "Mute or unmute an original stem. " +
      "Remember: max 1 original stem should be audible at a time — " +
      "mute other stems when unmuting one.",
    input_schema: {
      type: "object",
      properties: {
        stem_name: {
          type: "string",
          enum: ["vocals", "drums", "bass", "other"],
          description: "The original stem name.",
        },
        muted: {
          type: "boolean",
          description: "True to mute, false to unmute.",
        },
      },
      required: ["stem_name", "muted"],
    },
  },

  // -----------------------------------------------------------------------
  // Communication
  // -----------------------------------------------------------------------
  {
    name: "suggest_to_human",
    description:
      "Display a short message or suggestion to the human performer. " +
      "Use this to suggest what to play, give musical direction, or communicate intent.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The suggestion or message to display (keep it brief, 1-2 sentences).",
        },
        urgency: {
          type: "string",
          enum: ["info", "suggestion", "important"],
          description: 'How prominently to display the message. Default "suggestion".',
        },
      },
      required: ["message"],
    },
  },

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------
  {
    name: "get_session_state",
    description:
      "Get the current state of the entire session: which slots are filled, " +
      "by whom, what stems are active, and current mix levels.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },

  {
    name: "get_section_details",
    description:
      "Get detailed information about a specific performance section: " +
      "chord progression, slot states, and timing.",
    input_schema: {
      type: "object",
      properties: {
        section_id: {
          type: "string",
          description: 'The performance section ID (e.g. "perf_verse_1").',
        },
      },
      required: ["section_id"],
    },
  },
];
