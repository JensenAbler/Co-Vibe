/**
 * IndexedDB persistence layer using the `idb` package.
 *
 * Stores sessions (outline + recordings + transport snapshot) so
 * they survive page refreshes and can be browsed / exported later.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { SongOutline } from "@/types/song-outline";
import type { SlotRecording } from "@/types/session";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface DBSession {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  outline: SongOutline;
  recordings: SlotRecording[];
  transportState: {
    mutedTracks: string[];
    soloedTracks: string[];
    trackVolumes: Record<string, number>;
  };
}

/** Lightweight metadata returned by listSessions (no heavy payload). */
export interface DBSessionMeta {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  sourceFilename: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// Database singleton
// ---------------------------------------------------------------------------

const DB_NAME = "covibe";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("updated_at", "updated_at");
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/** Save (create or overwrite) a session. */
export async function saveSession(session: DBSession): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, session);
}

/** Load a single session by ID. */
export async function loadSession(
  id: string
): Promise<DBSession | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, id);
}

/** List all sessions — returns lightweight metadata sorted by most recent. */
export async function listSessions(): Promise<DBSessionMeta[]> {
  const db = await getDB();
  const all: DBSession[] = await db.getAll(STORE_NAME);

  return all
    .map((s) => ({
      id: s.id,
      name: s.name,
      created_at: s.created_at,
      updated_at: s.updated_at,
      sourceFilename: s.outline.source_track.filename,
      duration: s.outline.source_track.duration,
    }))
    .sort((a, b) => b.updated_at - a.updated_at);
}

/** Delete a session by ID. */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

/** Rename a session (updates name + updated_at). */
export async function renameSession(
  id: string,
  name: string
): Promise<void> {
  const db = await getDB();
  const session = await db.get(STORE_NAME, id);
  if (!session) return;
  session.name = name;
  session.updated_at = Date.now();
  await db.put(STORE_NAME, session);
}
