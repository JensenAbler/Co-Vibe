/**
 * Auto-save hook — debounces saves to IndexedDB after state changes.
 *
 * Wired into DAWView so that after every recording or transport stop,
 * the session is persisted automatically.
 */

import { useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "@/store/session-store";

/** Debounce delay in milliseconds. */
const AUTO_SAVE_DELAY = 800;

export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = useSessionStore((s) => s.sessionId);
  const recordings = useSessionStore((s) => s.recordings);

  const triggerSave = useCallback(() => {
    if (!sessionId) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      useSessionStore.getState().save();
    }, AUTO_SAVE_DELAY);
  }, [sessionId]);

  // Auto-save whenever recordings change
  useEffect(() => {
    if (recordings.length === 0) return;
    triggerSave();
  }, [recordings, triggerSave]);

  // Save on beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (sessionId) {
        // Attempt synchronous-ish save (best effort)
        useSessionStore.getState().save();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [sessionId]);

  return { triggerSave };
}
