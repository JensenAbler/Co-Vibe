/**
 * Types for the Claude Messages API integration.
 *
 * These mirror the subset of the Anthropic Messages API that the
 * Conductor uses for tool-use conversations.
 */

// ---------------------------------------------------------------------------
// Messages API request/response
// ---------------------------------------------------------------------------

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ClaudeMessage[];
  tools?: ClaudeToolDefinition[];
  tool_choice?: ClaudeToolChoice;
}

export interface ClaudeResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type ClaudeMessage =
  | { role: "user"; content: string | ClaudeContentBlock[] }
  | { role: "assistant"; content: ClaudeContentBlock[] };

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock;

export interface ClaudeTextBlock {
  type: "text";
  text: string;
}

export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ClaudeToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

// ---------------------------------------------------------------------------
// Conductor-specific types
// ---------------------------------------------------------------------------

/** MIDI events as described to/from Claude in tool calls. */
export interface ClaudeMidiEvent {
  note: number;
  velocity: number;
  /** Time in seconds relative to the start of the performance section. */
  time: number;
  /** Duration in seconds. */
  duration: number;
}

/** Queued plan for a single performance section. */
export interface SectionPlan {
  /** Performance section ID (e.g. "perf_verse_1") */
  sectionId: string;
  /** Tool calls to execute when this section starts playing. */
  toolCalls: ClaudeToolUseBlock[];
  /** Whether this plan has been executed. */
  executed: boolean;
}

/** A mix change action from Claude (volume, mute, solo). */
export interface MixChange {
  type: "volume" | "mute" | "unmute" | "solo" | "unsolo";
  target: "track" | "stem";
  name: string;
  value?: number;
}
