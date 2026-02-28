/**
 * Express routes ported from Vercel serverless functions.
 *
 * Routes:
 *   POST /api/claude        — Anthropic Messages API proxy (API key mode)
 *   POST /api/analyze       — Start Replicate prediction
 *   GET  /api/analyze/:id/status — Poll prediction status
 *   GET  /api/analyze/:id/result — Fetch completed prediction output
 *   POST /api/upload-url    — Vercel Blob client upload handler
 *   GET  /api/blobs         — List uploaded blobs
 */

import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { list } from "@vercel/blob";

/**
 * Register all API routes on the Express app.
 * Routes are registered directly on the app (not via Router())
 * to avoid Express v5 routing conflicts with the Agent SDK.
 */
export function registerApiRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // POST /api/claude — Anthropic Messages API proxy
  // -------------------------------------------------------------------------

  app.post("/api/claude", async (req, res) => {
    const token = req.headers["x-claude-token"];
    if (!token || typeof token !== "string") {
      res.status(401).json({ error: "Missing X-Claude-Token header" });
      return;
    }

    const { model, max_tokens, system, messages, tools, tool_choice } =
      req.body;
    if (!model || !max_tokens || !messages) {
      res.status(400).json({
        error: "Request body must include model, max_tokens, and messages",
      });
      return;
    }

    try {
      const isOAuth = token.startsWith("sk-ant-oat");
      const client = isOAuth
        ? new Anthropic({ authToken: token, apiKey: undefined })
        : new Anthropic({ apiKey: token });

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens,
        messages,
      };

      if (system) params.system = system;
      if (tools) params.tools = tools;
      if (tool_choice) params.tool_choice = tool_choice;

      const response = await client.messages.create(params);
      res.json(response);
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        res
          .status(err.status ?? 500)
          .json({
            error: `Anthropic API error (${err.status}): ${err.message}`,
          });
        return;
      }
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Unknown error calling Claude",
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/analyze — Start Replicate prediction
  // -------------------------------------------------------------------------

  app.post("/api/analyze", async (req, res) => {
    const token = process.env.REPLICATE_API_TOKEN?.trim();
    const modelVersion = process.env.REPLICATE_MODEL_VERSION?.trim();
    if (!token || !modelVersion) {
      res.status(500).json({ error: "Replicate env vars not configured" });
      return;
    }

    const { file_url } = req.body;
    if (!file_url) {
      res.status(400).json({ error: "file_url is required" });
      return;
    }

    try {
      const response = await fetch(
        "https://api.replicate.com/v1/predictions",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version: modelVersion,
            input: { audio: file_url },
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        res
          .status(response.status)
          .json({ error: `Replicate API error: ${text}` });
        return;
      }

      const prediction = await response.json();
      res.json({
        job_id: prediction.id,
        status: "queued",
        progress: 0.0,
        error: null,
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Unknown error creating prediction",
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analyze/:id/status — Poll prediction status
  // -------------------------------------------------------------------------

  const STATUS_MAP: Record<string, string> = {
    starting: "queued",
    processing: "analyzing",
    succeeded: "complete",
    failed: "failed",
    canceled: "failed",
  };

  const PROGRESS_MAP: Record<string, number> = {
    starting: 0.05,
    processing: 0.5,
    succeeded: 1.0,
    failed: 0.0,
    canceled: 0.0,
  };

  app.get("/api/analyze/:id/status", async (req, res) => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      res.status(500).json({ error: "REPLICATE_API_TOKEN not configured" });
      return;
    }

    const { id } = req.params;

    try {
      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${id}`,
        { headers: { Authorization: `Token ${token}` } }
      );

      if (!response.ok) {
        const text = await response.text();
        res
          .status(response.status)
          .json({ error: `Replicate API error: ${text}` });
        return;
      }

      const prediction = await response.json();
      res.json({
        job_id: prediction.id,
        status: STATUS_MAP[prediction.status] ?? "queued",
        progress: PROGRESS_MAP[prediction.status] ?? 0.0,
        error: prediction.error ? String(prediction.error) : null,
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Unknown error fetching status",
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/analyze/:id/result — Fetch completed prediction output
  // -------------------------------------------------------------------------

  const STEM_ORDER = ["vocals", "drums", "bass", "other"] as const;

  app.get("/api/analyze/:id/result", async (req, res) => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      res.status(500).json({ error: "REPLICATE_API_TOKEN not configured" });
      return;
    }

    const { id } = req.params;

    try {
      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${id}`,
        { headers: { Authorization: `Token ${token}` } }
      );

      if (!response.ok) {
        const text = await response.text();
        res
          .status(response.status)
          .json({ error: `Replicate API error: ${text}` });
        return;
      }

      const prediction = await response.json();

      if (prediction.status !== "succeeded") {
        res.status(409).json({ error: "Prediction not yet complete" });
        return;
      }

      const output = prediction.output;
      if (!output) {
        res.status(500).json({ error: "No output from prediction" });
        return;
      }

      let outlineUrl: string;
      const stemUrls: Record<string, string> = {};

      if (Array.isArray(output)) {
        outlineUrl = output[0];
        for (let i = 0; i < STEM_ORDER.length; i++) {
          const url = output[i + 1];
          if (url) stemUrls[STEM_ORDER[i]] = url;
        }
      } else {
        outlineUrl = String(output);
      }

      const outlineRes = await fetch(outlineUrl);
      if (!outlineRes.ok) {
        res
          .status(500)
          .json({
            error: "Failed to fetch outline from prediction output",
          });
        return;
      }

      const outline = await outlineRes.json();

      if (Object.keys(stemUrls).length > 0 && outline.stems) {
        for (const [name, url] of Object.entries(stemUrls)) {
          outline.stems[name] = url;
        }
      }

      res.json({ job_id: prediction.id, outline });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Unknown error fetching result",
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/upload-url — Vercel Blob client upload handler
  // -------------------------------------------------------------------------

  app.post("/api/upload-url", async (req, res) => {
    try {
      const body = await handleUpload({
        body: req.body as HandleUploadBody,
        request: req as any,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: [
            "audio/wav",
            "audio/x-wav",
            "audio/mpeg",
            "audio/mp3",
            "audio/ogg",
            "audio/flac",
            "audio/aac",
            "audio/mp4",
            "audio/webm",
          ],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB
        }),
        onUploadCompleted: async () => {
          // Could log or process here if needed
        },
      });

      res.json(body);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Upload failed",
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/blobs — List uploaded blobs
  // -------------------------------------------------------------------------

  app.get("/api/blobs", async (_req, res) => {
    try {
      const { blobs } = await list();

      const items = blobs.map((b) => ({
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt,
      }));

      res.json({ blobs: items });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Failed to list blobs",
      });
    }
  });

  console.log("[Routes] API routes registered (claude, analyze, upload-url, blobs)");
}
