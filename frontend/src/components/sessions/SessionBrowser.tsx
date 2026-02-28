/**
 * Session browser — Radix Dialog modal listing all saved sessions
 * with open, rename, export, delete, and import actions.
 */

import { useState, useEffect, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  FolderOpen,
  Download,
  Trash2,
  Pencil,
  Upload,
  X,
  Music,
} from "lucide-react";
import { cn } from "@/components/ui/utils";
import {
  listSessions,
  deleteSession,
  renameSession,
  loadSession,
  type DBSessionMeta,
} from "@/lib/db";
import { exportCovibe, importCovibe, downloadBlob } from "@/lib/covibe-file";
import { saveSession } from "@/lib/db";
import { useSessionStore } from "@/store/session-store";

interface SessionBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSessionLoaded?: () => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SessionBrowser({
  open,
  onOpenChange,
  onSessionLoaded,
}: SessionBrowserProps) {
  const [sessions, setSessions] = useState<DBSessionMeta[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await listSessions();
    setSessions(list);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // --- Actions ---

  const handleOpen = async (id: string) => {
    await useSessionStore.getState().loadFromDB(id);
    onOpenChange(false);
    onSessionLoaded?.();
  };

  const handleExport = async (id: string, name: string) => {
    const session = await loadSession(id);
    if (!session) return;
    const blob = exportCovibe(session);
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    downloadBlob(blob, `${safeName}.covibe`);
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    setConfirmDeleteId(null);
    refresh();
  };

  const handleRenameSubmit = async () => {
    if (!renamingId || !renameValue.trim()) return;
    await renameSession(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
    refresh();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const session = await importCovibe(file);
      await saveSession(session);
      refresh();
    } catch (err) {
      console.error("Import failed:", err);
    }
    // Reset input so the same file can be re-imported
    e.target.value = "";
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-0 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-5 py-3">
            <Dialog.Title className="text-sm font-semibold">
              Sessions
            </Dialog.Title>
            <div className="flex items-center gap-2">
              {/* Import button */}
              <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded bg-secondary px-2.5 text-xs font-medium hover:bg-secondary/80">
                <Upload className="h-3 w-3" />
                Import .covibe
                <input
                  type="file"
                  accept=".covibe"
                  className="hidden"
                  onChange={handleImport}
                />
              </label>
              <Dialog.Close asChild>
                <button className="rounded p-1 hover:bg-secondary">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Session list */}
          <div className="max-h-80 overflow-y-auto px-2 py-2">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <Music className="h-8 w-8 opacity-40" />
                <p className="text-sm">No saved sessions yet</p>
                <p className="text-xs opacity-60">
                  Upload a song and start a session to see it here.
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className="group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-secondary/60"
                  >
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      {renamingId === s.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleRenameSubmit();
                          }}
                          className="flex gap-1"
                        >
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            autoFocus
                            className="flex-1 rounded border bg-background px-2 py-0.5 text-xs"
                            onBlur={() => setRenamingId(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                          />
                        </form>
                      ) : (
                        <>
                          <p className="truncate text-xs font-medium">
                            {s.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {s.sourceFilename} &middot;{" "}
                            {formatDuration(s.duration)} &middot;{" "}
                            {formatDate(s.updated_at)}
                          </p>
                        </>
                      )}
                    </div>

                    {/* Confirm delete */}
                    {confirmDeleteId === s.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-red-400">
                          Delete?
                        </span>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="rounded bg-red-600 px-2 py-0.5 text-[10px] text-white hover:bg-red-700"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded bg-secondary px-2 py-0.5 text-[10px] hover:bg-secondary/80"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      /* Action buttons */
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpen(s.id)}
                          title="Open session"
                          className="rounded p-1.5 hover:bg-secondary"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setRenamingId(s.id);
                            setRenameValue(s.name);
                          }}
                          title="Rename"
                          className="rounded p-1.5 hover:bg-secondary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleExport(s.id, s.name)}
                          title="Export .covibe"
                          className="rounded p-1.5 hover:bg-secondary"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(s.id)}
                          title="Delete session"
                          className="rounded p-1.5 text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
