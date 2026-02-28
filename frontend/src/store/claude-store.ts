/**
 * Zustand store for Claude token management.
 *
 * Accepts both OAuth tokens (sk-ant-oat01-...) and API keys (sk-ant-api03-...).
 *
 * Auth routing:
 * - OAuth tokens → local Agent SDK server (localhost:3001)
 * - API keys → Vercel proxy (/api/claude)
 *
 * Persists in localStorage so it survives page reloads.
 * Validates via health check (OAuth) or minimal API call (API key).
 */

import { create } from "zustand";
import {
  validateToken,
  detectAuthMode,
  type AuthMode,
} from "@/api/claude-client";

const STORAGE_KEY = "covibe_claude_token";

interface ClaudeStore {
  /** OAuth token (sk-ant-oat01-...) or API key (sk-ant-api03-...) or null */
  token: string | null;
  /** Whether the token has been validated — null = untested */
  isValid: boolean | null;
  /** Whether a validation request is in flight */
  isValidating: boolean;
  /** Detected authentication mode */
  authMode: AuthMode | null;

  // Actions
  setToken: (token: string) => Promise<void>;
  clearToken: () => void;
}

export const useClaudeStore = create<ClaudeStore>((set) => ({
  token: loadStoredToken(),
  isValid: null,
  isValidating: false,
  authMode: loadStoredAuthMode(),

  setToken: async (token: string) => {
    const authMode = detectAuthMode(token);

    // Store immediately so it persists
    localStorage.setItem(STORAGE_KEY, token);
    set({ token, authMode, isValid: null, isValidating: true });

    // Validate with appropriate method
    const valid = await validateToken(token);
    set({ isValid: valid, isValidating: false });
  },

  clearToken: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({
      token: null,
      isValid: null,
      isValidating: false,
      authMode: null,
    });
  },
}));

function loadStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadStoredAuthMode(): AuthMode | null {
  const token = loadStoredToken();
  if (!token) return null;
  return detectAuthMode(token);
}

/**
 * Auto-validate the stored token on first load.
 * Called once at app startup (side-effect).
 */
const storedToken = loadStoredToken();
if (storedToken) {
  // Kick off validation in the background
  useClaudeStore.getState().setToken(storedToken);
}
