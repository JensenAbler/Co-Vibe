/**
 * GET /api/analyze/:id/status
 *
 * Proxies prediction status from Replicate and maps it to the
 * AnalysisStatus shape the frontend expects.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import Replicate from "replicate";

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

  return res.status(200).json({
    job_id: prediction.id,
    status: STATUS_MAP[prediction.status] ?? "queued",
    progress: PROGRESS_MAP[prediction.status] ?? 0.0,
    error: prediction.error ? String(prediction.error) : null,
  });
}
