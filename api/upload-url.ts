/**
 * POST /api/upload-url
 *
 * Handles Vercel Blob client uploads so the browser can upload
 * large audio files directly, bypassing Vercel's 4.5MB body limit.
 *
 * The @vercel/blob/client `upload()` function calls this endpoint
 * twice: once to get an upload token, once to confirm completion.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
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

    return res.status(200).json(body);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Upload failed",
    });
  }
}
