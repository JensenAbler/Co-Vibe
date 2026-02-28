/**
 * Zustand store for Claude token management.
 *
 * Accepts both OAuth tokens (sk-ant-oat01-...) and API keys (sk-ant-api03-...).
 * The server proxy auto-detects the type and uses the appropriate SDK auth method.
 * Persists in localStorage so it survives page reloads.
 * Validates via a minimal Claude API call.
 */

import { create } from "zustand";
import { validateToken } from "@/api/claude-client";

const STORAGE_KEY = "covibe_claude_token";

interface ClaudeStore {
  /** OAuth token (sk-ant-oat01-...) or API key (sk-ant-api03-...) or null */
  token: string | null;
  /** Whether the token has been validated — null = untested */
  isValid: boolean | null;
  /** Whether a validation request is in flight */
  isValidating: boolean;

  // Actions
  setToken: (token: string) => Promise<void>;
  clearToken: () => void;
}

export const useClaudeStore = create<ClaudeStore>((set, get) => ({
  token: loadStoredToken(),
  isValid: null,
  isValidating: false,

  setToken: async (token: string) => {
    // Store immediately so it persists
    localStorage.setItem(STORAGE_KEY, token);
    set({ token, isValid: null, isValidating: true });

    // Validate with a minimal API call
    const valid = await validateToken(token);
    set({ isValid: valid, isValidating: false });
  },

  clearToken: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, isValid: null, isValidating: false });
  },
}));

function loadStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
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
