import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { FolderOpen, Music } from "lucide-react";
import { cn } from "@/components/ui/utils";
import { uploadForAnalysis, pollUntilComplete } from "@/api/analysis-client";
import { useSessionStore } from "@/store/session-store";
import { listSessions, type DBSessionMeta } from "@/lib/db";
import { SessionBrowser } from "@/components/sessions/SessionBrowser";
import type { AnalysisStatus } from "@/types/song-outline";

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued...",
  separating: "Separating stems...",
  analyzing: "Analyzing key, beats & structure...",
  assembling: "Assembling song outline...",
};

export function UploadView() {
  const [, navigate] = useLocation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionBrowserOpen, setSessionBrowserOpen] = useState(false);
  const [recentSessions, setRecentSessions] = useState<DBSessionMeta[]>([]);

  // Load recent sessions on mount
  useEffect(() => {
    listSessions().then((list) => setRecentSessions(list.slice(0, 3)));
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setIsAnalyzing(true);
      setError(null);
      setAnalysisStatus(null);

      try {
        const { job_id } = await uploadForAnalysis(file);

        const result = await pollUntilComplete(job_id, (status) => {
          setAnalysisStatus(status);
        });

        // Create a new session from the analysis result
        useSessionStore.getState().createSession(result.outline);
        // Auto-save immediately
        await useSessionStore.getState().save();
        navigate("/perform");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analysis failed");
        setIsAnalyzing(false);
      }
    },
    [navigate]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleRetry = () => {
    setError(null);
    setIsAnalyzing(false);
    setAnalysisStatus(null);
  };

  const handleOpenSession = async (id: string) => {
    await useSessionStore.getState().loadFromDB(id);
    navigate("/perform");
  };

  const handleSessionLoaded = () => {
    navigate("/perform");
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Co Vibe</h1>
        <p className="mt-2 text-muted-foreground">
          Drop a track. The agent learns its structure. You fill in the parts.
        </p>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={handleRetry}
            className="rounded bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80"
          >
            Try again
          </button>
        </div>
      ) : isAnalyzing ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {analysisStatus
              ? STATUS_LABELS[analysisStatus.status] ?? "Processing..."
              : "Uploading..."}
          </p>
          {analysisStatus && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${(analysisStatus.progress ?? 0) * 100}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <label
            className={cn(
              "flex h-64 w-full max-w-lg cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors",
              isDragOver
                ? "border-primary bg-primary/10"
                : "border-muted-foreground/30 hover:border-muted-foreground/50"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <svg
              className="mb-3 h-10 w-10 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15"
              />
            </svg>
            <p className="text-sm font-medium text-muted-foreground">
              Drop an audio file here, or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              WAV, MP3, FLAC, OGG
            </p>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileInput}
            />
          </label>

          {/* Recent sessions + browse all */}
          <div className="flex w-full max-w-lg flex-col gap-3">
            {recentSessions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Recent sessions
                </p>
                {recentSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleOpenSession(s.id)}
                    className="flex w-full items-center gap-3 rounded-md border border-border/50 px-3 py-2 text-left transition-colors hover:bg-secondary/50"
                  >
                    <Music className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{s.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {s.sourceFilename}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground/60">
                      {new Date(s.updated_at).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => setSessionBrowserOpen(true)}
              className="flex items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/30 py-2 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {recentSessions.length > 0
                ? "Browse all sessions..."
                : "Load a saved session"}
            </button>
          </div>
        </>
      )}

      {/* Session browser modal */}
      <SessionBrowser
        open={sessionBrowserOpen}
        onOpenChange={setSessionBrowserOpen}
        onSessionLoaded={handleSessionLoaded}
      />
    </div>
  );
}
