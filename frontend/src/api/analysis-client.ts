/**
 * HTTP client for the analysis API.
 *
 * Supports two modes controlled by VITE_API_MODE:
 * - "replicate" (production): upload via Vercel Blob, then POST
 *   { file_url } to Vercel serverless function → Replicate
 * - default (local dev): multipart POST directly to FastAPI
 */

import type { AnalysisStatus, AnalysisResult } from "@/types/song-outline";
import { upload } from "@vercel/blob/client";

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
  // 1. Upload to Vercel Blob (browser → Blob storage directly, no size limit)
  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: `${API_BASE}/upload-url`,
    contentType: file.type || "audio/wav",
  });

  // 2. Tell our API to start analysis with the blob URL
  const analyzeRes = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: blob.url }),
  });

  if (!analyzeRes.ok) {
    throw new Error(`Analysis start failed: ${analyzeRes.status}`);
  }

  return analyzeRes.json();
}

/**
 * Start analysis from an already-uploaded blob URL (skips upload step).
 */
export async function analyzeFromUrl(blobUrl: string): Promise<AnalysisStatus> {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_url: blobUrl }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Analysis start failed: ${res.status} – ${text}`);
  }

  return res.json();
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
