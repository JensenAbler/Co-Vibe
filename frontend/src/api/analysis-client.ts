/**
 * HTTP client for the analysis API.
 *
 * Supports two modes controlled by VITE_API_MODE:
 * - "replicate" (production): presigned upload to Replicate Files API,
 *   then POST { file_url } to Vercel serverless function
 * - default (local dev): multipart POST directly to FastAPI
 */

import type { AnalysisStatus, AnalysisResult } from "@/types/song-outline";

const API_BASE = "/api";
const IS_REPLICATE = import.meta.env.VITE_API_MODE === "replicate";

/**
 * Upload an audio file to start analysis.
 *
 * In local mode: multipart POST to FastAPI.
 * In production: presigned PUT to Replicate Files, then POST file_url.
 */
export async function uploadForAnalysis(file: File): Promise<AnalysisStatus> {
  if (IS_REPLICATE) {
    return uploadViaReplicate(file);
  }
  return uploadDirect(file);
}

async function uploadDirect(file: File): Promise<AnalysisStatus> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function uploadViaReplicate(file: File): Promise<AnalysisStatus> {
  // 1. Get a presigned upload URL from our Vercel function
  const urlRes = await fetch(
    `${API_BASE}/upload-url?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(file.type || "audio/wav")}`
  );

  if (!urlRes.ok) {
    throw new Error(`Failed to get upload URL: ${urlRes.status}`);
  }

  const { upload_url, file_url } = await urlRes.json();

  // 2. PUT the file bytes directly to Replicate storage
  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "audio/wav" },
    body: file,
  });

  if (!putRes.ok) {
    throw new Error(`File upload failed: ${putRes.status}`);
  }

  // 3. Tell our API to start analysis with the uploaded file URL
  const analyzeRes = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url }),
  });

  if (!analyzeRes.ok) {
    throw new Error(`Analysis start failed: ${analyzeRes.status}`);
  }

  return analyzeRes.json();
}

/**
 * Poll the analysis job status.
 */
export async function getAnalysisStatus(
  jobId: string
): Promise<AnalysisStatus> {
  const res = await fetch(`${API_BASE}/analyze/${jobId}/status`);

  if (!res.ok) {
    throw new Error(`Status check failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch the completed Song Outline.
 */
export async function getAnalysisResult(
  jobId: string
): Promise<AnalysisResult> {
  const res = await fetch(`${API_BASE}/analyze/${jobId}/result`);

  if (!res.ok) {
    throw new Error(`Result fetch failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Get the URL for a separated stem audio file.
 */
export function getStemUrl(jobId: string, stemName: string): string {
  return `${API_BASE}/analyze/${jobId}/stems/${stemName}`;
}

/**
 * Poll analysis status until complete or failed.
 * Calls onProgress on each poll.
 */
export async function pollUntilComplete(
  jobId: string,
  onProgress?: (status: AnalysisStatus) => void,
  intervalMs = 2000
): Promise<AnalysisResult> {
  while (true) {
    const status = await getAnalysisStatus(jobId);
    onProgress?.(status);

    if (status.status === "complete") {
      return getAnalysisResult(jobId);
    }

    if (status.status === "failed") {
      throw new Error(status.error ?? "Analysis failed");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
