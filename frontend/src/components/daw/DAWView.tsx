/**
 * Main DAW (Digital Audio Workstation) view — the performance interface.
 *
 * Displays the song outline as a timeline with tracks, section markers,
 * a playhead, and agent prompts. This is a structural placeholder that
 * will be built out in Phase 4.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useSessionStore } from "@/store/session-store";
import type { SectionLabel } from "@/types/song-outline";

const SECTION_COLORS: Record<SectionLabel, { bg: string; text: string }> = {
  intro: { bg: "bg-blue-500/20", text: "text-blue-400" },
  verse: { bg: "bg-green-500/20", text: "text-green-400" },
  chorus: { bg: "bg-orange-500/20", text: "text-orange-400" },
  bridge: { bg: "bg-purple-500/20", text: "text-purple-400" },
  instrumental: { bg: "bg-cyan-500/20", text: "text-cyan-400" },
  solo: { bg: "bg-yellow-500/20", text: "text-yellow-400" },
  outro: { bg: "bg-rose-500/20", text: "text-rose-400" },
  break: { bg: "bg-gray-500/20", text: "text-gray-400" },
};

const TRACK_LABELS = ["Melody", "Chords", "Bass", "Drums", "Pad"] as const;

export function DAWView() {
  const [, navigate] = useLocation();
  const outline = useSessionStore((s) => s.outline);

  // Redirect to upload if no outline is loaded
  useEffect(() => {
    if (!outline) navigate("/");
  }, [outline, navigate]);

  if (!outline) return null;

  const { key, tempo, time_signature } = outline;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Transport bar */}
      <header className="flex h-12 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold">Co Vibe</h1>
          <div className="flex items-center gap-2">
            <button className="rounded bg-secondary px-3 py-1 text-xs font-medium hover:bg-secondary/80">
              Stop
            </button>
            <button className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/80">
              Play
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{Math.round(tempo.bpm)} BPM</span>
          <span>{key.tonic} {key.mode}</span>
          <span>{time_signature.numerator}/{time_signature.denominator}</span>
        </div>
      </header>

      {/* Timeline + Tracks area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Section markers */}
        <div className="flex h-8 items-center gap-px border-b bg-card/50 px-2">
          {outline.sections.map((section) => {
            const colors = SECTION_COLORS[section.label] ?? SECTION_COLORS.intro;
            return (
              <span
                key={section.id}
                className={`rounded-sm px-2 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}
              >
                {section.label.charAt(0).toUpperCase() + section.label.slice(1)}
              </span>
            );
          })}
        </div>

        {/* Track rows */}
        <div className="flex-1 overflow-y-auto">
          {TRACK_LABELS.map((track) => (
            <div
              key={track}
              className="flex h-16 items-center border-b border-border/50"
            >
              {/* Track label + controls */}
              <div className="flex w-32 shrink-0 items-center justify-between border-r px-3">
                <span className="text-xs font-medium">{track}</span>
                <div className="flex gap-1">
                  <button className="h-5 w-5 rounded text-[10px] font-bold text-muted-foreground hover:bg-secondary">
                    M
                  </button>
                  <button className="h-5 w-5 rounded text-[10px] font-bold text-muted-foreground hover:bg-secondary">
                    S
                  </button>
                </div>
              </div>
              {/* Track content area (timeline) */}
              <div className="flex-1 bg-secondary/20 px-1">
                <div className="h-10 rounded-sm border border-dashed border-muted-foreground/20" />
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Agent prompt area */}
      <footer className="flex h-16 items-center justify-center border-t bg-card">
        <p className="text-sm text-muted-foreground">
          Agent is idle. Press Play to begin the co-performance.
        </p>
      </footer>
    </div>
  );
}
