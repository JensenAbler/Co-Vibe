/**
 * GET /api/upload-url
 *
 * Creates a Replicate Files API upload URL so the browser can PUT
 * audio bytes directly, bypassing Vercel's 4.5MB body limit.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "REPLICATE_API_TOKEN not configured" });
  }

  const filename = (req.query.filename as string) || "upload.wav";
  const content_type = (req.query.content_type as string) || "audio/wav";

  const response = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename,
      content_type,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return res.status(response.status).json({ error: `Replicate Files API error: ${text}` });
  }

  const data = await response.json();
  return res.status(200).json({
    upload_url: data.urls.put,
    file_url: data.urls.get,
  });
}
