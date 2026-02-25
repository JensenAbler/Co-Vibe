/**
 * Main DAW (Digital Audio Workstation) view — the performance interface.
 *
 * Displays the song outline as a timeline with tracks, section markers,
 * a playhead, and agent prompts. This is a structural placeholder that
 * will be built out in Phase 4.
 */
export function DAWView() {
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
          <span>120 BPM</span>
          <span>Am</span>
          <span>4/4</span>
        </div>
      </header>

      {/* Timeline + Tracks area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Section markers */}
        <div className="flex h-8 items-center gap-px border-b bg-card/50 px-2">
          <span className="rounded-sm bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-400">
            Intro
          </span>
          <span className="rounded-sm bg-green-500/20 px-2 py-0.5 text-[10px] font-medium text-green-400">
            Verse
          </span>
          <span className="rounded-sm bg-orange-500/20 px-2 py-0.5 text-[10px] font-medium text-orange-400">
            Chorus
          </span>
        </div>

        {/* Track rows */}
        <div className="flex-1 overflow-y-auto">
          {["Melody", "Chords", "Bass", "Drums", "Pad"].map((track) => (
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
