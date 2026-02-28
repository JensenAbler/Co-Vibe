/**
 * POST /api/claude
 *
 * Proxies requests to the Anthropic Messages API using the official SDK.
 * The user's token is passed via X-Claude-Token header.
 *
 * Auto-detects token type:
 * - sk-ant-oat01-... → OAuth (Authorization: Bearer via SDK authToken)
 * - sk-ant-api03-... → API key (x-api-key via SDK apiKey)
 *
 * This endpoint does NOT store or log tokens.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Extract the user's token from the request header
  const token = req.headers["x-claude-token"];
  if (!token || typeof token !== "string") {
    return res.status(401).json({ error: "Missing X-Claude-Token header" });
  }

  // Validate that the body has the expected shape
  const { model, max_tokens, system, messages, tools, tool_choice } = req.body;
  if (!model || !max_tokens || !messages) {
    return res.status(400).json({
      error: "Request body must include model, max_tokens, and messages",
    });
  }

  try {
    // Auto-detect token type and create SDK client accordingly
    const isOAuth = token.startsWith("sk-ant-oat");
    const client = isOAuth
      ? new Anthropic({ authToken: token, apiKey: undefined })
      : new Anthropic({ apiKey: token });

    // Build the request params
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens,
      messages,
    };

    if (system) params.system = system;
    if (tools) params.tools = tools;
    if (tool_choice) params.tool_choice = tool_choice;

    const response = await client.messages.create(params);
    return res.status(200).json(response);
  } catch (err) {
    // Extract useful error info from SDK errors
    if (err instanceof Anthropic.APIError) {
      return res.status(err.status ?? 500).json({
        error: `Anthropic API error (${err.status}): ${err.message}`,
      });
    }
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error calling Claude",
    });
  }
}
