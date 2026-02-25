/**
 * Agent state machine types.
 */

export type AgentState =
  | "idle"
  | "playing_intro"
  | "prompting"
  | "recording"
  | "reviewing"
  | "agent_filling"
  | "transitioning"
  | "completing"
  | "finished";

export interface AgentContext {
  state: AgentState;
  /** Index of the current section in the outline */
  current_section_index: number;
  /** ID of the slot currently being prompted or filled */
  current_slot_id: string | null;
  /** Current chord symbol for harmonic context */
  current_chord: string | null;
  /** Beats the user has been idle (for timeout transitions) */
  idle_beats: number;
}
