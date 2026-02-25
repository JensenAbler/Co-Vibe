import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { cn } from "@/components/ui/utils";

/**
 * Upload view — the landing page where users drop an audio file
 * to start the analysis pipeline.
 *
 * Phase 5 will wire this to the actual analysis API.
 */
export function UploadView() {
  const [, navigate] = useLocation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    []
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    []
  );

  const handleFile = (_file: File) => {
    setIsAnalyzing(true);
    // TODO (Phase 5): Upload to /api/analyze and poll for status
    // For now, simulate analysis and navigate to DAW view
    setTimeout(() => {
      navigate("/perform");
    }, 1500);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Co Vibe</h1>
        <p className="mt-2 text-muted-foreground">
          Drop a track. The agent learns its structure. You fill in the parts.
        </p>
      </div>

      {isAnalyzing ? (
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Analyzing...</p>
        </div>
      ) : (
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
      )}
    </div>
  );
}
