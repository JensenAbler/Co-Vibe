/**
 * HTTP client for the Python analysis API.
 *
 * Handles file upload, status polling, and result fetching.
 */

import type { AnalysisStatus, AnalysisResult } from "@/types/song-outline";

const API_BASE = "/api";

/**
 * Upload an audio file to start analysis.
 */
export async function uploadForAnalysis(file: File): Promise<AnalysisStatus> {
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
