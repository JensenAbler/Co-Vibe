/**
 * Co Vibe unified server.
 *
 * Consolidates everything into one Express app:
 *   - Static frontend serving (frontend/dist)
 *   - /api/claude         — Anthropic Messages API proxy (API key mode)
 *   - /api/analyze/*      — Replicate prediction proxy
 *   - /api/upload-url     — Vercel Blob client upload
 *   - /api/blobs          — List uploaded blobs
 *   - /api/conductor/*    — Agent SDK Conductor (OAuth mode, Blind MCP)
 *   - /health             — Health check
 *
 * Deploy to Railway (or any long-running Node host) with:
 *   npm run start
 */

import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import {
  query,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import type { SystemMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  createConductorTools,
  type ClientSessionState,
} from "./conductor-mcp.js";
import { sessionManager } from "./session-manager.js";
import { registerApiRoutes } from "./api-routes.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIST = path.resolve(__dirname, "..", "frontend", "dist");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ---------------------------------------------------------------------------
// OAuth token resolution
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;

/**
 * Resolve the OAuth token.
 * Priority: CLAUDE_CODE_OAUTH_TOKEN env var > ~/.claude/.credentials.json
 */
function resolveOAuthToken(): string | null {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  if (cachedToken) return cachedToken;

  try {
    const credPath = path.join(
      os.homedir(),
      ".claude",
      ".credentials.json"
    );
    const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    if (creds?.claudeAiOauth?.accessToken) {
      cachedToken = creds.claudeAiOauth.accessToken;
      return cachedToken;
    }
  } catch {
    // Not found — that's OK
  }

  return null;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// CORS — allow all origins in production since we serve the frontend ourselves
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-Claude-Token"],
  })
);

app.use(express.json({ limit: "5mb" }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  const token = resolveOAuthToken();
  res.json({
    status: "ok",
    hasToken: !!token,
    sessions: sessionManager.size,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// API routes (ported from Vercel serverless)
// ---------------------------------------------------------------------------

registerApiRoutes(app);

// ---------------------------------------------------------------------------
// POST /api/conductor/draft — Agent SDK Conductor
// ---------------------------------------------------------------------------

interface DraftRequest {
  systemPrompt: string;
  sessionState: ClientSessionState;
  outlineId: string;
}

app.post("/api/conductor/draft", async (req, res) => {
  const { systemPrompt, sessionState, outlineId } =
    req.body as DraftRequest;

  if (!systemPrompt || !sessionState || !outlineId) {
    res.status(400).json({
      error: "Missing systemPrompt, sessionState, or outlineId",
    });
    return;
  }

  console.log(`[Draft] Starting for outline ${outlineId}`);

  try {
    const { tools, getRecordedCalls } =
      createConductorTools(sessionState);

    const mcpServer = createSdkMcpServer({
      name: "conductor",
      tools,
    });

    const sdkEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) sdkEnv[k] = v;
    }
    const token = resolveOAuthToken();
    if (token) {
      sdkEnv.CLAUDE_CODE_OAUTH_TOKEN = token;
    }

    const draftPrompt =
      "Generate a draft arrangement for the entire performance. " +
      "Fill all tracks (except melody) for every section using generate_midi. " +
      "Also set initial stem state with mute_stem calls.";

    let sessionId: string | null = null;

    for await (const message of query({
      prompt: draftPrompt,
      options: {
        systemPrompt,
        model: "sonnet",
        maxTurns: 10,
        mcpServers: { conductor: mcpServer },
        env: sdkEnv,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (
        message.type === "system" &&
        (message as SystemMessage).subtype === "init"
      ) {
        sessionId = (message as SystemMessage).session_id ?? null;
        if (sessionId) {
          sessionManager.set(outlineId, sessionId);
          console.log(
            `[Draft] Session created: ${sessionId.slice(0, 12)}...`
          );
        }
      }
    }

    const toolCalls = getRecordedCalls();
    console.log(
      `[Draft] Complete. ${toolCalls.length} tool calls recorded.`
    );

    res.json({
      sessionId: sessionManager.get(outlineId),
      toolCalls,
    });
  } catch (err) {
    console.error("[Draft] Error:", err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : "Unknown error during draft",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/conductor/plan — Agent SDK Conductor
// ---------------------------------------------------------------------------

interface PlanRequest {
  outlineId: string;
  prompt: string;
  systemPrompt: string;
  sessionState: ClientSessionState;
}

app.post("/api/conductor/plan", async (req, res) => {
  const { outlineId, prompt, systemPrompt, sessionState } =
    req.body as PlanRequest;

  if (!outlineId || !prompt || !sessionState) {
    res.status(400).json({
      error: "Missing outlineId, prompt, or sessionState",
    });
    return;
  }

  console.log(`[Plan] Starting for outline ${outlineId}`);

  try {
    const { tools, getRecordedCalls } =
      createConductorTools(sessionState);

    const mcpServer = createSdkMcpServer({
      name: "conductor",
      tools,
    });

    const sdkEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) sdkEnv[k] = v;
    }
    const token = resolveOAuthToken();
    if (token) {
      sdkEnv.CLAUDE_CODE_OAUTH_TOKEN = token;
    }

    const existingSessionId = sessionManager.get(outlineId);

    const fullPrompt = existingSessionId
      ? `[System context update]\n${systemPrompt}\n\n[Task]\n${prompt}`
      : prompt;

    const queryOptions: Record<string, unknown> = {
      model: "sonnet",
      maxTurns: 5,
      mcpServers: { conductor: mcpServer },
      env: sdkEnv,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    };

    if (existingSessionId) {
      queryOptions.resume = existingSessionId;
      console.log(
        `[Plan] Resuming session ${existingSessionId.slice(0, 12)}...`
      );
    } else {
      queryOptions.systemPrompt = systemPrompt;
      console.log("[Plan] No existing session, starting fresh");
    }

    let newSessionId: string | null = null;

    for await (const message of query({
      prompt: fullPrompt,
      options: queryOptions as Parameters<typeof query>[0]["options"],
    })) {
      if (
        message.type === "system" &&
        (message as SystemMessage).subtype === "init"
      ) {
        newSessionId = (message as SystemMessage).session_id ?? null;
        if (newSessionId) {
          sessionManager.set(outlineId, newSessionId);
        }
      }
    }

    const toolCalls = getRecordedCalls();
    console.log(
      `[Plan] Complete. ${toolCalls.length} tool calls recorded.`
    );

    res.json({ toolCalls });
  } catch (err) {
    console.error("[Plan] Error:", err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : "Unknown error during plan",
    });
  }
});

// ---------------------------------------------------------------------------
// Static frontend serving
// ---------------------------------------------------------------------------

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));

  // SPA fallback — any non-API route serves index.html
  // Express v5 requires named wildcard params instead of bare "*"
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });

  console.log(`[Static] Serving frontend from ${FRONTEND_DIST}`);
} else {
  console.log(
    `[Static] Frontend not built yet (${FRONTEND_DIST} not found). Run: npm run build:frontend`
  );
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(
    `\n  Co Vibe server running on http://localhost:${PORT}`
  );
  console.log(`  Health check: http://localhost:${PORT}/health\n`);

  const token = resolveOAuthToken();
  if (token) {
    console.log(
      `  OAuth token: ${token.slice(0, 16)}...${token.slice(-4)}`
    );
  } else {
    console.log(
      "  No OAuth token found (API key mode only)."
    );
  }

  const envVars = ["REPLICATE_API_TOKEN", "REPLICATE_MODEL_VERSION", "BLOB_READ_WRITE_TOKEN"];
  const missing = envVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.log(`  Missing env vars: ${missing.join(", ")}`);
  } else {
    console.log("  All env vars configured ✓");
  }

  console.log("");
});
