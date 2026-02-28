/**
 * The Conductor — orchestrates Claude as a co-performer.
 *
 * Dual-mode operation:
 * - **OAuth** (sk-ant-oat01-...): Routes through local Agent SDK server.
 *   The server manages the agentic loop and returns tool calls for
 *   browser-side execution via the "Blind MCP" pattern.
 *
 * - **API key** (sk-ant-api03-...): Routes through Vercel proxy with
 *   a manual agentic loop (original behavior, kept as fallback).
 *
 * Lifecycle:
 * 1. Created when a session loads on /perform
 * 2. generateDraftArrangement() called before play
 * 3. onSectionTransition() called by engine clock on section boundaries
 * 4. onHumanRecording() called when human fills a slot
 * 5. Destroyed on session unload
 *
 * Plain TypeScript singleton (like AudioEngine).
 */

import type {
  ClaudeMessage,
  ClaudeContentBlock,
  ClaudeToolUseBlock,
  ClaudeToolResultBlock,
  SectionPlan,
} from "@/types/claude";
import type { SlotRecording } from "@/types/session";
import {
  callClaude,
  callConductorDraft,
  callConductorPlan,
  type RecordedToolCall,
  type ConductorSessionState,
} from "@/api/claude-client";
import { useClaudeStore } from "@/store/claude-store";
import { useConductorStore } from "@/store/conductor-store";
import { useSessionStore } from "@/store/session-store";
import { useTransportStore } from "@/store/transport-store";
import { CONDUCTOR_TOOLS } from "./tool-definitions";
import { buildSystemPrompt, buildDraftPrompt } from "./system-prompt";
import { executeTool } from "./tool-executor";
import type { PerformanceOutline } from "./performance-outline";
import type { SessionStateSummary, SlotSummary } from "./system-prompt";

// ---------------------------------------------------------------------------
// Conductor class
// ---------------------------------------------------------------------------

export class Conductor {
  private outline: PerformanceOutline;
  /** Conversation history — only used in API key mode. */
  private conversationHistory: ClaudeMessage[] = [];
  private pendingPlan: SectionPlan | null = null;
  private planningAbortController: AbortController | null = null;
  /** Human recording notes to include in next planning prompt. */
  private humanRecordingNotes: string[] = [];

  constructor(outline: PerformanceOutline) {
    this.outline = outline;
  }

  // -----------------------------------------------------------------------
  // Auth mode detection
  // -----------------------------------------------------------------------

  private get isOAuth(): boolean {
    return useClaudeStore.getState().authMode === "oauth";
  }

  // -----------------------------------------------------------------------
  // Draft arrangement
  // -----------------------------------------------------------------------

  /**
   * Generate a full draft arrangement before play.
   * Routes to Agent SDK server (OAuth) or manual loop (API key).
   */
  async generateDraftArrangement(): Promise<void> {
    const token = useClaudeStore.getState().token;
    if (!token) {
      useConductorStore.getState().setError("No Claude token configured");
      return;
    }

    useConductorStore.getState().setPhase("drafting");

    try {
      if (this.isOAuth) {
        await this.generateDraftViaAgentSDK();
      } else {
        await this.generateDraftViaAPIKey(token);
      }
      useConductorStore.getState().setPhase("ready");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error during draft";
      useConductorStore.getState().setError(message);
      useConductorStore.getState().setPhase("idle");
    }
  }

  // -----------------------------------------------------------------------
  // OAuth path: Agent SDK server
  // -----------------------------------------------------------------------

  /**
   * Draft via the local Agent SDK server.
   * Server runs the agentic loop and returns recorded tool calls.
   */
  private async generateDraftViaAgentSDK(): Promise<void> {
    const systemPrompt = buildDraftPrompt(this.outline);
    const sessionState = this.buildConductorSessionState();
    const outlineId = this.getOutlineId();

    const response = await callConductorDraft(
      systemPrompt,
      sessionState,
      outlineId
    );

    // Execute each recorded tool call browser-side
    this.executeRecordedToolCalls(response.toolCalls, "agent-draft");
  }

  /**
   * Plan a section via the local Agent SDK server.
   */
  private async planSectionViaAgentSDK(
    sectionIndex: number
  ): Promise<void> {
    const section = this.outline.sections[sectionIndex];
    const currentSectionIndex = Math.max(0, sectionIndex - 1);
    const sessionState = this.buildConductorSessionState();
    const outlineId = this.getOutlineId();

    const systemPrompt = buildSystemPrompt(
      this.outline,
      this.gatherSessionState(),
      currentSectionIndex,
      sectionIndex
    );

    // Build planning context (same as before, but as a string for the server)
    const prompt = this.buildPlanningContext(sectionIndex);

    const response = await callConductorPlan(
      outlineId,
      prompt,
      systemPrompt,
      sessionState
    );

    // Store as pending plan (action tools only — queries already handled server-side)
    const toolCalls = response.toolCalls.map(
      (tc, i): ClaudeToolUseBlock => ({
        type: "tool_use",
        id: `sdk_${sectionIndex}_${i}`,
        name: tc.name,
        input: tc.args,
      })
    );

    this.pendingPlan = {
      sectionId: section.id,
      toolCalls,
      executed: false,
    };
  }

  // -----------------------------------------------------------------------
  // API key path: Manual agentic loop (original behavior)
  // -----------------------------------------------------------------------

  /**
   * Draft via direct API calls through the Vercel proxy.
   * Runs a manual agentic loop with tool use.
   */
  private async generateDraftViaAPIKey(token: string): Promise<void> {
    const systemPrompt = buildDraftPrompt(this.outline);

    const messages: ClaudeMessage[] = [
      {
        role: "user",
        content:
          "Generate a draft arrangement for the entire performance. " +
          "Fill all tracks (except melody) for every section using generate_midi. " +
          "Also set initial stem state with mute_stem calls.",
      },
    ];

    // Claude may need multiple rounds of tool use
    let response = await callClaude(token, {
      system: systemPrompt,
      messages,
      tools: CONDUCTOR_TOOLS,
      tool_choice: { type: "any" },
      max_tokens: 8192,
    });

    // Process tool calls in a loop until Claude is done
    let iterations = 0;
    const maxIterations = 10;

    while (
      response.stop_reason === "tool_use" &&
      iterations < maxIterations
    ) {
      iterations++;

      // Execute all tool calls in this response
      const toolResults = this.processToolCalls(
        response.content,
        "agent-draft"
      );

      // Build the next message with tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      // Continue the conversation
      response = await callClaude(token, {
        system: systemPrompt,
        messages,
        tools: CONDUCTOR_TOOLS,
        max_tokens: 8192,
      });
    }

    // Store the full draft conversation in history
    this.conversationHistory = messages;
    if (response.content.length > 0) {
      this.conversationHistory.push({
        role: "assistant",
        content: response.content,
      });
    }
  }

  /**
   * Plan a section via direct API calls (API key mode).
   */
  private async planSectionViaAPIKey(
    sectionIndex: number,
    token: string
  ): Promise<void> {
    if (sectionIndex < 0 || sectionIndex >= this.outline.sections.length) {
      return;
    }

    const currentSectionIndex = Math.max(0, sectionIndex - 1);
    const sessionState = this.gatherSessionState();

    const systemPrompt = buildSystemPrompt(
      this.outline,
      sessionState,
      currentSectionIndex,
      sectionIndex
    );

    // Add context about what's happened so far
    const contextMessage = this.buildPlanningContext(sectionIndex);

    const messages: ClaudeMessage[] = [
      ...this.conversationHistory,
      { role: "user", content: contextMessage },
    ];

    let response = await callClaude(token, {
      system: systemPrompt,
      messages,
      tools: CONDUCTOR_TOOLS,
      tool_choice: { type: "auto" },
      max_tokens: 4096,
    });

    // Collect all tool calls for this section plan
    const allToolCalls: ClaudeToolUseBlock[] = [];
    let iterations = 0;
    const maxIterations = 5;

    while (
      response.stop_reason === "tool_use" &&
      iterations < maxIterations
    ) {
      iterations++;

      // Collect tool calls but DON'T execute them yet — queue them
      const toolCalls = response.content.filter(
        (b): b is ClaudeToolUseBlock => b.type === "tool_use"
      );
      allToolCalls.push(...toolCalls);

      // For state-query tools, execute immediately and feed back
      const queryTools = toolCalls.filter((t) =>
        ["get_session_state", "get_section_details"].includes(t.name)
      );
      const actionTools = toolCalls.filter(
        (t) =>
          !["get_session_state", "get_section_details"].includes(t.name)
      );

      // Execute queries, mock-acknowledge actions
      const toolResults: ClaudeToolResultBlock[] = [];
      for (const tc of queryTools) {
        const result = executeTool(tc, this.outline, "agent");
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: result.content,
          is_error: result.is_error,
        });
      }
      for (const tc of actionTools) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: "Queued for execution at section transition.",
        });
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      response = await callClaude(token, {
        system: systemPrompt,
        messages,
        tools: CONDUCTOR_TOOLS,
        max_tokens: 4096,
      });
    }

    // Collect any final tool calls
    const finalToolCalls = response.content.filter(
      (b): b is ClaudeToolUseBlock => b.type === "tool_use"
    );
    allToolCalls.push(...finalToolCalls);

    // Filter to only action tools (not queries)
    const actionToolCalls = allToolCalls.filter(
      (t) =>
        !["get_session_state", "get_section_details"].includes(t.name)
    );

    // Store the plan
    this.pendingPlan = {
      sectionId: this.outline.sections[sectionIndex].id,
      toolCalls: actionToolCalls,
      executed: false,
    };

    // Update conversation history
    this.conversationHistory = messages;
    if (response.content.length > 0) {
      this.conversationHistory.push({
        role: "assistant",
        content: response.content,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Section-ahead planning (public interface)
  // -----------------------------------------------------------------------

  /**
   * Plan Claude's contribution for a specific section.
   * Called asynchronously while the current section plays.
   */
  async planSection(sectionIndex: number): Promise<void> {
    const token = useClaudeStore.getState().token;
    if (!token) return;

    if (sectionIndex < 0 || sectionIndex >= this.outline.sections.length) {
      return;
    }

    // Cancel any in-flight planning
    this.planningAbortController?.abort();
    this.planningAbortController = new AbortController();

    useConductorStore.getState().setPlanning(true);

    try {
      if (this.isOAuth) {
        await this.planSectionViaAgentSDK(sectionIndex);
      } else {
        await this.planSectionViaAPIKey(sectionIndex, token);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return; // Planning was cancelled
      }
      console.error("Planning failed:", err);
      useConductorStore
        .getState()
        .setError(
          err instanceof Error ? err.message : "Planning failed"
        );
    } finally {
      useConductorStore.getState().setPlanning(false);
    }
  }

  // -----------------------------------------------------------------------
  // Section transitions
  // -----------------------------------------------------------------------

  /**
   * Called by the engine clock when a section boundary is crossed.
   *
   * 1. Execute the pending plan for the new section
   * 2. Start async planning for the NEXT section
   */
  onSectionTransition(fromIndex: number, toIndex: number): void {
    useConductorStore.getState().setPhase("performing");

    // Execute pending plan if it's for this section
    if (this.pendingPlan && !this.pendingPlan.executed) {
      const expectedSection = this.outline.sections[toIndex];
      if (
        expectedSection &&
        this.pendingPlan.sectionId === expectedSection.id
      ) {
        this.executePlan(this.pendingPlan);
      }
    }

    // Start planning the next section (async, non-blocking)
    const nextIndex = toIndex + 1;
    if (nextIndex < this.outline.sections.length) {
      this.planSection(nextIndex);
    }
  }

  /**
   * Execute a section plan — run all queued tool calls.
   */
  private executePlan(plan: SectionPlan): void {
    for (const toolCall of plan.toolCalls) {
      executeTool(toolCall, this.outline, "agent");
    }
    plan.executed = true;
  }

  // -----------------------------------------------------------------------
  // Human recording events
  // -----------------------------------------------------------------------

  /**
   * Called when the human fills a slot.
   * Updates context so Claude adapts in future planning.
   */
  onHumanRecording(recording: SlotRecording): void {
    // Find which performance section this recording belongs to
    const slot = this.outline.slots.find((s) => s.id === recording.slot_id);
    if (!slot) return;

    const section = this.outline.sections.find(
      (s) => s.id === slot.sectionId
    );
    if (!section) return;

    const summary = `Human recorded ${recording.track_name} in ${section.label} (${section.id}): ${recording.midi_events.length} MIDI events.`;

    if (this.isOAuth) {
      // In OAuth mode, store note for next planning prompt
      this.humanRecordingNotes.push(summary);
    } else {
      // In API key mode, add to conversation history
      this.conversationHistory.push({
        role: "user",
        content: summary,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Execute recorded tool calls from the Agent SDK server response.
   * Converts RecordedToolCall[] to ClaudeToolUseBlock[] and executes them.
   */
  private executeRecordedToolCalls(
    toolCalls: RecordedToolCall[],
    source: "agent-draft" | "agent"
  ): void {
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const toolUseBlock: ClaudeToolUseBlock = {
        type: "tool_use",
        id: `sdk_${source}_${i}`,
        name: tc.name,
        input: tc.args,
      };
      executeTool(toolUseBlock, this.outline, source);
    }
  }

  /**
   * Process tool_use blocks from a Claude response (API key mode).
   * Returns tool_result blocks for the next message.
   */
  private processToolCalls(
    content: ClaudeContentBlock[],
    source: "agent-draft" | "agent"
  ): ClaudeToolResultBlock[] {
    const results: ClaudeToolResultBlock[] = [];

    for (const block of content) {
      if (block.type === "tool_use") {
        const result = executeTool(block, this.outline, source);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.content,
          is_error: result.is_error,
        });
      }
    }

    return results;
  }

  /**
   * Build a context message for section planning.
   */
  private buildPlanningContext(sectionIndex: number): string {
    const section = this.outline.sections[sectionIndex];
    const parts: string[] = [];

    parts.push(
      `We're about to enter the ${section.label} section (${section.id}).`
    );
    parts.push(
      `Plan your contribution for this section. ` +
        `The chord progression is: ${section.chords
          .map((c) => c.chord)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(" → ")}`
    );

    // Note what the human has played recently
    const sessionStore = useSessionStore.getState();
    const recentRecordings = sessionStore.recordings.filter(
      (r) => r.source === "user"
    );
    if (recentRecordings.length > 0) {
      const lastRecording = recentRecordings[recentRecordings.length - 1];
      parts.push(
        `The human most recently recorded ${lastRecording.track_name} ` +
          `(${lastRecording.midi_events.length} events).`
      );
    }

    // Include any human recording notes (OAuth mode)
    if (this.humanRecordingNotes.length > 0) {
      parts.push(
        `Recent human activity: ${this.humanRecordingNotes.join(" ")}`
      );
      this.humanRecordingNotes = []; // Clear after including
    }

    parts.push(
      "Use generate_midi to create your parts. " +
        "Use suggest_to_human if you have guidance for the performer."
    );

    return parts.join(" ");
  }

  /**
   * Gather current session state for the system prompt.
   */
  private gatherSessionState(): SessionStateSummary {
    const sessionStore = useSessionStore.getState();
    const transportStore = useTransportStore.getState();

    const slots: SlotSummary[] = this.outline.slots.map((slot) => {
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

    const mutedStems = ["vocals", "drums", "bass", "other"].filter((s) =>
      transportStore.mutedTracks.has(s)
    );

    const activeStems = ["vocals", "drums", "bass", "other"].filter(
      (s) => !transportStore.mutedTracks.has(s)
    );

    return {
      slots,
      mutedStems,
      activeStem: activeStems.length === 1 ? activeStems[0] : null,
      mutedTracks: Array.from(transportStore.mutedTracks).filter((t) =>
        ["melody", "bass", "chords", "drums", "pad"].includes(t)
      ),
      soloedTracks: Array.from(transportStore.soloedTracks),
    };
  }

  /**
   * Build the ConductorSessionState for Agent SDK server requests.
   * Includes all state the server needs for Blind MCP query tools.
   */
  private buildConductorSessionState(): ConductorSessionState {
    const sessionStore = useSessionStore.getState();
    const transportStore = useTransportStore.getState();

    const slots = this.outline.slots.map((slot) => {
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

    const mutedStems = ["vocals", "drums", "bass", "other"].filter((s) =>
      transportStore.mutedTracks.has(s)
    );

    const activeStems = ["vocals", "drums", "bass", "other"].filter(
      (s) => !transportStore.mutedTracks.has(s)
    );

    // Build section details for get_section_details query tool
    const sections = this.outline.sections.map((section) => {
      const sectionSlots = this.outline.slots
        .filter((s) => s.sectionId === section.id)
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

      return {
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
    });

    return {
      slots,
      muted_tracks: Array.from(transportStore.mutedTracks).filter((t) =>
        ["melody", "bass", "chords", "drums", "pad"].includes(t)
      ),
      soloed_tracks: Array.from(transportStore.soloedTracks),
      muted_stems: mutedStems,
      active_stem: activeStems.length === 1 ? activeStems[0] : null,
      sections,
    };
  }

  /**
   * Get a stable outline ID for session management.
   */
  private getOutlineId(): string {
    // Use a hash of the song info as a stable ID
    const original = this.outline.original;
    return `${original.source_track.filename ?? "untitled"}_${original.tempo.bpm}_${original.key.tonic}`;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  dispose(): void {
    this.planningAbortController?.abort();
    this.conversationHistory = [];
    this.pendingPlan = null;
    this.humanRecordingNotes = [];
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let conductorInstance: Conductor | null = null;

export function getConductor(): Conductor | null {
  return conductorInstance;
}

export function createConductor(outline: PerformanceOutline): Conductor {
  conductorInstance?.dispose();
  conductorInstance = new Conductor(outline);
  return conductorInstance;
}

export function destroyConductor(): void {
  conductorInstance?.dispose();
  conductorInstance = null;
  useConductorStore.getState().reset();
}
