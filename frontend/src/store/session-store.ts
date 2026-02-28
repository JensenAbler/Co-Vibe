/**
 * Zustand store for the current session state.
 *
 * Holds the song outline, slot recordings, session identity, and
 * provides actions for filling slots, saving / loading from IndexedDB.
 */

import { create } from "zustand";
import type { SongOutline, Slot, SlotStatus } from "@/types/song-outline";
import type { SlotRecording } from "@/types/session";
import {
  saveSession as dbSave,
  loadSession as dbLoad,
  type DBSession,
} from "@/lib/db";
import { useTransportStore } from "./transport-store";

interface SessionState {
  /** Unique ID for the current session (null before first save / load). */
  sessionId: string | null;
  /** Human-readable session name. */
  sessionName: string;
  /** The analyzed song outline, null before analysis completes. */
  outline: SongOutline | null;
  /** Per-slot recordings (user or agent). */
  recordings: SlotRecording[];
  /** Whether the store is dirty (unsaved changes). */
  isDirty: boolean;
  /** Timestamp of last successful save. */
  lastSavedAt: number | null;

  // Actions
  setOutline: (outline: SongOutline) => void;
  updateSlotStatus: (slotId: string, status: SlotStatus) => void;
  addRecording: (recording: SlotRecording) => void;
  /** Remove all recordings for a given slot ID. */
  removeRecording: (slotId: string) => void;
  reset: () => void;

  /** Create a brand-new session from an outline. */
  createSession: (outline: SongOutline, name?: string) => void;
  /** Persist current state to IndexedDB. */
  save: () => Promise<void>;
  /** Load a session from IndexedDB and populate all stores. */
  loadFromDB: (id: string) => Promise<void>;
  /** Mark dirty flag manually. */
  markDirty: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  sessionName: "Untitled Session",
  outline: null,
  recordings: [],
  isDirty: false,
  lastSavedAt: null,

  setOutline: (outline) => set({ outline, isDirty: true }),

  updateSlotStatus: (slotId, status) =>
    set((state) => {
      if (!state.outline) return state;
      return {
        isDirty: true,
        outline: {
          ...state.outline,
          slots: state.outline.slots.map((slot: Slot) =>
            slot.id === slotId ? { ...slot, status } : slot
          ),
        },
      };
    }),

  addRecording: (recording) =>
    set((state) => ({
      recordings: [...state.recordings, recording],
      isDirty: true,
    })),

  removeRecording: (slotId) =>
    set((state) => ({
      recordings: state.recordings.filter((r) => r.slot_id !== slotId),
      isDirty: true,
    })),

  reset: () =>
    set({
      sessionId: null,
      sessionName: "Untitled Session",
      outline: null,
      recordings: [],
      isDirty: false,
      lastSavedAt: null,
    }),

  createSession: (outline, name) => {
    const sessionId = crypto.randomUUID();
    const sessionName =
      name ?? outline.source_track.filename.replace(/\.[^.]+$/, "");
    set({
      sessionId,
      sessionName,
      outline,
      recordings: [],
      isDirty: true,
      lastSavedAt: null,
    });
  },

  save: async () => {
    const { sessionId, sessionName, outline, recordings } = get();
    if (!sessionId || !outline) return;

    const transport = useTransportStore.getState();

    const dbSession: DBSession = {
      id: sessionId,
      name: sessionName,
      created_at: get().lastSavedAt ?? Date.now(),
      updated_at: Date.now(),
      outline,
      recordings,
      transportState: {
        mutedTracks: Array.from(transport.mutedTracks),
        soloedTracks: Array.from(transport.soloedTracks),
        trackVolumes: { ...transport.trackVolumes },
      },
    };

    try {
      await dbSave(dbSession);
      set({ isDirty: false, lastSavedAt: Date.now() });
    } catch (err) {
      console.error("Failed to save session:", err);
    }
  },

  loadFromDB: async (id) => {
    const session = await dbLoad(id);
    if (!session) {
      console.warn(`Session ${id} not found in IndexedDB`);
      return;
    }

    // Restore transport state
    const transport = useTransportStore.getState();
    for (const track of session.transportState.mutedTracks) {
      if (!transport.mutedTracks.has(track)) {
        transport.toggleMute(track);
      }
    }
    for (const track of session.transportState.soloedTracks) {
      if (!transport.soloedTracks.has(track)) {
        transport.toggleSolo(track);
      }
    }
    for (const [track, vol] of Object.entries(
      session.transportState.trackVolumes
    )) {
      transport.setVolume(track, vol);
    }

    set({
      sessionId: session.id,
      sessionName: session.name,
      outline: session.outline,
      recordings: session.recordings,
      isDirty: false,
      lastSavedAt: session.updated_at,
    });
  },

  markDirty: () => set({ isDirty: true }),
}));
