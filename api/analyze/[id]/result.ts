/**
 * GET /api/analyze/:id/result
 *
 * Fetches the completed prediction output from Replicate and returns
 * it as an AnalysisResult (with the SongOutline).
 *
 * The prediction output is an ordered array of CDN URLs:
 *   [0] outline.json
 *   [1] vocals.wav
 *   [2] drums.wav
 *   [3] bass.wav
 *   [4] other.wav
 *
 * This endpoint fetches outline.json, injects the stem CDN URLs,
 * and returns the complete outline to the frontend.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

// Must match STEM_ORDER in predict.py
const STEM_ORDER = ["vocals", "drums", "bass", "other"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN not configured" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing prediction id" });
  }

  try {
    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${id}`,
      { headers: { Authorization: `Token ${token}` } }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Replicate API error: ${text}` });
    }

    const prediction = await response.json();

    if (prediction.status !== "succeeded") {
      return res.status(409).json({ error: "Prediction not yet complete" });
    }

    const output = prediction.output;
    if (!output) {
      return res.status(500).json({ error: "No output from prediction" });
    }

    // Handle both formats:
    // - Array of URLs (new Iterator[CogPath] format)
    // - Single URL string (legacy single CogPath format)
    let outlineUrl: string;
    let stemUrls: Record<string, string> = {};

    if (Array.isArray(output)) {
      // New format: [outline.json, vocals.wav, drums.wav, bass.wav, other.wav]
      outlineUrl = output[0];

      // Map remaining URLs to stem names by position
      for (let i = 0; i < STEM_ORDER.length; i++) {
        const url = output[i + 1];
        if (url) {
          stemUrls[STEM_ORDER[i]] = url;
        }
      }
    } else {
      // Legacy format: single URL to outline.json
      outlineUrl = String(output);
    }

    // Fetch the outline JSON
    const outlineRes = await fetch(outlineUrl);
    if (!outlineRes.ok) {
      return res.status(500).json({ error: "Failed to fetch outline from prediction output" });
    }

    const outline = await outlineRes.json();

    // Inject stem CDN URLs into the outline
    if (Object.keys(stemUrls).length > 0 && outline.stems) {
      for (const [name, url] of Object.entries(stemUrls)) {
        outline.stems[name] = url;
      }
    }

    return res.status(200).json({
      job_id: prediction.id,
      outline,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error fetching result",
    });
  }
}
