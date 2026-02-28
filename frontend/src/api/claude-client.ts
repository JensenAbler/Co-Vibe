/**
 * HTTP client for Claude API integration.
 *
 * Dual-mode:
 * - **API key** (sk-ant-api03-...): Direct API proxy via /api/claude
 * - **OAuth** (sk-ant-oat01-...): Agent SDK Conductor via /api/conductor/*
 *
 * Both paths go through the same server — no more separate localhost server.
 */

import type {
  ClaudeRequest,
  ClaudeResponse,
  ClaudeMessage,
  ClaudeToolDefinition,
  ClaudeToolChoice,
} from "@/types/claude";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = "/api";

// ---------------------------------------------------------------------------
// Token type detection
// ---------------------------------------------------------------------------

export type AuthMode = "oauth" | "api-key";

/** Detect auth mode from token prefix. */
export function detectAuthMode(token: string): AuthMode {
  return token.startsWith("sk-ant-oat") ? "oauth" : "api-key";
}

// ---------------------------------------------------------------------------
// API key path: Direct Claude Messages API proxy
// ---------------------------------------------------------------------------

/**
 * Send a request to the Claude Messages API via our proxy.
 * Used for API key authentication only.
 *
 * @throws {Error} on network or API errors.
 */
export async function callClaude(
  token: string,
  options: {
    model?: string;
    max_tokens?: number;
    system?: string;
    messages: ClaudeMessage[];
    tools?: ClaudeToolDefinition[];
    tool_choice?: ClaudeToolChoice;
  }
): Promise<ClaudeResponse> {
  const body: ClaudeRequest = {
    model: options.model ?? "claude-sonnet-4-20250514",
    max_tokens: options.max_tokens ?? 4096,
    messages: options.messages,
  };

  if (options.system) body.system = options.system;
  if (options.tools) body.tools = options.tools;
  if (options.tool_choice) body.tool_choice = options.tool_choice;

  const res = await fetch(`${API_BASE}/claude`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Claude-Token": token,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error (${res.status}): ${text}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// OAuth path: Agent SDK Conductor (same server, /api/conductor/*)
// ---------------------------------------------------------------------------

/** Session state sent from frontend to the Agent SDK server. */
export interface ConductorSessionState {
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

/** A tool call recorded by the Agent SDK server's Blind MCP pattern. */
export interface RecordedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Response from the /api/conductor/draft endpoint. */
export interface DraftResponse {
  sessionId: string | null;
  toolCalls: RecordedToolCall[];
}

/** Response from the /api/conductor/plan endpoint. */
export interface PlanResponse {
  toolCalls: RecordedToolCall[];
}

/**
 * Generate a draft arrangement via the Agent SDK Conductor.
 *
 * @throws {Error} on network or server errors.
 */
export async function callConductorDraft(
  systemPrompt: string,
  sessionState: ConductorSessionState,
  outlineId: string
): Promise<DraftResponse> {
  const res = await fetch(`${API_BASE}/conductor/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, sessionState, outlineId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Conductor draft error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Plan a section via the Agent SDK Conductor.
 *
 * @throws {Error} on network or server errors.
 */
export async function callConductorPlan(
  outlineId: string,
  prompt: string,
  systemPrompt: string,
  sessionState: ConductorSessionState
): Promise<PlanResponse> {
  const res = await fetch(`${API_BASE}/conductor/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outlineId, prompt, systemPrompt, sessionState }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Conductor plan error (${res.status}): ${text}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a token.
 * - API key: Minimal Claude API call.
 * - OAuth: Health check on the server.
 */
export async function validateToken(token: string): Promise<boolean> {
  const mode = detectAuthMode(token);

  if (mode === "oauth") {
    return validateOAuthToken();
  }

  // API key validation
  try {
    await callClaude(token, {
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return true;
  } catch (err) {
    console.error(
      "[Co Vibe] API key validation failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Validate OAuth by checking the server health endpoint.
 * The server auto-detects the OAuth token from its environment.
 */
async function validateOAuthToken(): Promise<boolean> {
  try {
    const res = await fetch("/health", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === "ok" && data.hasToken === true;
  } catch (err) {
    console.error(
      "[Co Vibe] OAuth validation failed:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
