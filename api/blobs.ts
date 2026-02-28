/**
 * GET /api/blobs
 *
 * Lists audio files stored in Vercel Blob.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { list } from "@vercel/blob";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { blobs } = await list();

    const items = blobs.map((b) => ({
      url: b.url,
      pathname: b.pathname,
      size: b.size,
      uploadedAt: b.uploadedAt,
    }));

    return res.status(200).json({ blobs: items });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list blobs",
    });
  }
}
