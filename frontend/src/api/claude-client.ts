/**
 * HTTP client for the Claude Messages API (via /api/claude proxy).
 *
 * Sends the user's token (OAuth or API key) in X-Claude-Token header.
 * The Vercel serverless function auto-detects the token type and uses
 * the official Anthropic SDK with the appropriate auth method.
 */

import type {
  ClaudeRequest,
  ClaudeResponse,
  ClaudeMessage,
  ClaudeToolDefinition,
  ClaudeToolChoice,
} from "@/types/claude";

const API_BASE = "/api";

/**
 * Send a request to the Claude Messages API via our proxy.
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

/**
 * Validate a token by making a minimal Claude API call.
 * Returns true if the token is valid, false otherwise.
 */
export async function validateToken(token: string): Promise<boolean> {
  try {
    await callClaude(token, {
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return true;
  } catch {
    return false;
  }
}
