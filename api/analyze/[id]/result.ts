/**
 * GET /api/analyze/:id/result
 *
 * Fetches the completed prediction output from Replicate and returns
 * it as an AnalysisResult (with the SongOutline).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Replicate from "replicate";

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

  const replicate = new Replicate({ auth: token });
  const prediction = await replicate.predictions.get(id);

  if (prediction.status !== "succeeded") {
    return res.status(409).json({ error: "Prediction not yet complete" });
  }

  // Cog predict.py returns a file URL to outline.json
  const outputUrl = prediction.output;
  if (!outputUrl) {
    return res.status(500).json({ error: "No output from prediction" });
  }

  // Fetch the outline JSON from the Replicate file URL
  const outlineRes = await fetch(String(outputUrl));
  if (!outlineRes.ok) {
    return res.status(500).json({ error: "Failed to fetch outline from prediction output" });
  }

  const outline = await outlineRes.json();

  return res.status(200).json({
    job_id: prediction.id,
    outline,
  });
}
