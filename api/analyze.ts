/**
 * POST /api/analyze
 *
 * Receives { file_url } from the frontend, creates a Replicate prediction,
 * and returns an AnalysisStatus response.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.REPLICATE_API_TOKEN?.trim();
  const modelVersion = process.env.REPLICATE_MODEL_VERSION?.trim();
  if (!token || !modelVersion) {
    return res.status(500).json({ error: "Replicate env vars not configured" });
  }

  const { file_url } = req.body;
  if (!file_url) {
    return res.status(400).json({ error: "file_url is required" });
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
      return res.status(response.status).json({ error: `Replicate API error: ${text}` });
    }

    const prediction = await response.json();

    return res.status(200).json({
      job_id: prediction.id,
      status: "queued",
      progress: 0.0,
      error: null,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error creating prediction",
    });
  }
}
