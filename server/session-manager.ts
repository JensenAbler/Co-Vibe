/**
 * Session manager for Agent SDK resume feature.
 *
 * Maps outlineId → sessionId so the Conductor can resume conversations
 * across draft → plan → plan → ... calls. The Agent SDK manages the
 * full conversation history internally when we use `resume: sessionId`.
 *
 * Sessions are kept in memory — they're ephemeral and scoped to the
 * server's lifetime. If the server restarts, a new draft will create
 * a fresh session.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionEntry {
  sessionId: string;
  outlineId: string;
  createdAt: number;
  lastUsedAt: number;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

class SessionManager {
  private sessions = new Map<string, SessionEntry>();

  /**
   * Store a new session ID for an outline.
   * Replaces any existing session for that outline.
   */
  set(outlineId: string, sessionId: string): void {
    this.sessions.set(outlineId, {
      sessionId,
      outlineId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    console.log(
      `[SessionManager] Stored session ${sessionId.slice(0, 12)}... for outline ${outlineId}`
    );
  }

  /**
   * Get the session ID for an outline.
   * Returns null if no session exists.
   */
  get(outlineId: string): string | null {
    const entry = this.sessions.get(outlineId);
    if (!entry) return null;
    entry.lastUsedAt = Date.now();
    return entry.sessionId;
  }

  /**
   * Remove the session for an outline.
   */
  remove(outlineId: string): void {
    this.sessions.delete(outlineId);
  }

  /**
   * Clean up sessions older than maxAge (ms).
   * Default: 2 hours.
   */
  cleanup(maxAge = 2 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now - entry.lastUsedAt > maxAge) {
        this.sessions.delete(key);
        console.log(
          `[SessionManager] Expired session for outline ${key}`
        );
      }
    }
  }

  /**
   * Number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }
}

// Singleton
export const sessionManager = new SessionManager();

// Periodic cleanup every 30 minutes
setInterval(() => sessionManager.cleanup(), 30 * 60 * 1000);
