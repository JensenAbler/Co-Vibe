/**
 * .covibe ZIP file export / import.
 *
 * A `.covibe` file is a renamed ZIP containing:
 *   manifest.json          — version, id, timestamps, source track info
 *   outline.json           — full SongOutline
 *   recordings/<slot_id>.midi.json — one file per SlotRecording
 *
 * Uses `fflate` for fast, lightweight ZIP compression.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { DBSession } from "./db";
import type { SlotRecording } from "@/types/session";
import type { SongOutline } from "@/types/song-outline";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

interface CovibeManifest {
  version: 1;
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  source_track: {
    filename: string;
    duration: number;
    sample_rate: number;
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Create a .covibe ZIP blob from a DBSession. */
export function exportCovibe(session: DBSession): Blob {
  const manifest: CovibeManifest = {
    version: 1,
    id: session.id,
    name: session.name,
    created_at: session.created_at,
    updated_at: session.updated_at,
    source_track: {
      filename: session.outline.source_track.filename,
      duration: session.outline.source_track.duration,
      sample_rate: session.outline.source_track.sample_rate,
    },
  };

  // Build file map for fflate
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "outline.json": strToU8(JSON.stringify(session.outline, null, 2)),
  };

  // Separate user vs agent recordings
  for (const rec of session.recordings) {
    const folder =
      rec.source === "agent" ? "agent-fills" : "recordings";
    const key = `${folder}/${rec.slot_id}.midi.json`;
    files[key] = strToU8(JSON.stringify(rec, null, 2));
  }

  // Add transport state
  files["transport.json"] = strToU8(
    JSON.stringify(session.transportState, null, 2)
  );

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Parse a .covibe ZIP file into a DBSession ready for IndexedDB. */
export async function importCovibe(file: File): Promise<DBSession> {
  const buffer = await file.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(buffer));

  // Read manifest
  const manifestRaw = unzipped["manifest.json"];
  if (!manifestRaw) throw new Error("Invalid .covibe file: missing manifest.json");
  const manifest: CovibeManifest = JSON.parse(strFromU8(manifestRaw));

  // Read outline
  const outlineRaw = unzipped["outline.json"];
  if (!outlineRaw) throw new Error("Invalid .covibe file: missing outline.json");
  const outline: SongOutline = JSON.parse(strFromU8(outlineRaw));

  // Read recordings
  const recordings: SlotRecording[] = [];
  for (const [path, data] of Object.entries(unzipped)) {
    if (
      (path.startsWith("recordings/") || path.startsWith("agent-fills/")) &&
      path.endsWith(".midi.json")
    ) {
      recordings.push(JSON.parse(strFromU8(data)));
    }
  }

  // Read transport state (optional)
  let transportState: DBSession["transportState"] = {
    mutedTracks: [],
    soloedTracks: [],
    trackVolumes: {},
  };
  const transportRaw = unzipped["transport.json"];
  if (transportRaw) {
    transportState = JSON.parse(strFromU8(transportRaw));
  }

  // Generate a new ID so imports don't collide with existing sessions
  const newId = crypto.randomUUID();

  return {
    id: newId,
    name: manifest.name,
    created_at: manifest.created_at,
    updated_at: Date.now(),
    outline,
    recordings,
    transportState,
  };
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
