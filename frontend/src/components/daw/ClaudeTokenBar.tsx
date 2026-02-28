/**
 * ClaudeTokenBar — inline token input that lives in the TransportBar.
 *
 * Accepts both token types (auto-detected by the server proxy):
 * - OAuth tokens (sk-ant-oat01-...) → Authorization: Bearer via SDK authToken
 * - API keys (sk-ant-api03-...)     → x-api-key via SDK apiKey
 *
 * States:
 * - No token: Key icon + paste input field
 * - Validating: Spinner
 * - Valid: Green dot + "Claude Connected"
 * - Invalid: Red dot + "Invalid" + retry/clear
 *
 * Always visible — not a modal.
 */

import { useState, useCallback, useRef } from "react";
import { KeyRound, Loader2, X } from "lucide-react";
import { cn } from "@/components/ui/utils";
import { useClaudeStore } from "@/store/claude-store";

export function ClaudeTokenBar() {
  const token = useClaudeStore((s) => s.token);
  const isValid = useClaudeStore((s) => s.isValid);
  const isValidating = useClaudeStore((s) => s.isValidating);

  const setToken = useClaudeStore((s) => s.setToken);
  const clearToken = useClaudeStore((s) => s.clearToken);

  const [inputValue, setInputValue] = useState("");
  const [showInput, setShowInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setToken(trimmed);
    setInputValue("");
    setShowInput(false);
  }, [inputValue, setToken]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setShowInput(false);
        setInputValue("");
      }
    },
    [handleSubmit]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").trim();
      if (pasted) {
        setToken(pasted);
        setInputValue("");
        setShowInput(false);
      }
    },
    [setToken]
  );

  // --- Validating state ---
  if (isValidating) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Validating...</span>
      </div>
    );
  }

  // --- Valid token ---
  if (token && isValid === true) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-[10px] text-green-400">Claude</span>
        <button
          onClick={clearToken}
          title="Disconnect Claude"
          className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  // --- Invalid token ---
  if (token && isValid === false) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="text-[10px] text-red-400">Invalid</span>
        <button
          onClick={clearToken}
          title="Clear and retry"
          className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  // --- No token: show input or prompt ---
  if (showInput) {
    return (
      <div className="flex items-center gap-1">
        <KeyRound className="h-3 w-3 text-muted-foreground" />
        <input
          ref={inputRef}
          type="password"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="sk-ant-oat01-... or sk-ant-api03-..."
          autoFocus
          className={cn(
            "h-6 w-[180px] rounded border bg-secondary px-1.5 text-[10px]",
            "text-foreground placeholder:text-muted-foreground/50",
            "focus:outline-none focus:ring-1 focus:ring-primary/50"
          )}
        />
        <button
          onClick={() => {
            setShowInput(false);
            setInputValue("");
          }}
          className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  }

  // --- Prompt to paste token ---
  return (
    <button
      onClick={() => {
        setShowInput(true);
        // Focus after render
        setTimeout(() => inputRef.current?.focus(), 0);
      }}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
    >
      <KeyRound className="h-3 w-3" />
      <span>Claude Token</span>
    </button>
  );
}
