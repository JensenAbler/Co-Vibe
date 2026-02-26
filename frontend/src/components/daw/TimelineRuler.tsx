/**
 * Timeline ruler — shows bar numbers and beat tick marks above the tracks.
 * Supports click-to-seek.
 */

import { useCallback, useRef } from "react";
import { useTransportStore } from "@/store/transport-store";
import type { SongOutline } from "@/types/song-outline";

interface TimelineRulerProps {
  outline: SongOutline;
  totalDuration: number;
}

export function TimelineRuler({ outline, totalDuration }: TimelineRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const el = rulerRef.current;
      if (!el || totalDuration <= 0) return;

      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = x / rect.width;
      const seekTime = percent * totalDuration;

      useTransportStore.getState().seek(seekTime);
    },
    [totalDuration]
  );

  // Build bar markers from downbeats
  const bars: { barNum: number; percent: number }[] = [];
  for (let i = 0; i < outline.downbeats.length; i++) {
    bars.push({
      barNum: i + 1,
      percent: (outline.downbeats[i] / totalDuration) * 100,
    });
  }

  // Build beat ticks (intermediate beats between downbeats)
  const downbeatSet = new Set(
    outline.downbeats.map((t) => Math.round(t * 1000))
  );
  const beatTicks: { percent: number; isDownbeat: boolean }[] = [];
  for (const beat of outline.beats) {
    const isDownbeat = downbeatSet.has(Math.round(beat * 1000));
    beatTicks.push({
      percent: (beat / totalDuration) * 100,
      isDownbeat,
    });
  }

  return (
    <div className="relative flex h-6 items-end border-b bg-card/30">
      {/* Spacer for track labels column */}
      <div className="w-32 shrink-0 border-r px-3">
        <span className="text-[9px] text-muted-foreground/50">BAR</span>
      </div>

      {/* Ruler area */}
      <div
        ref={rulerRef}
        className="relative flex-1 cursor-pointer overflow-hidden"
        onClick={handleClick}
      >
        {/* Beat tick marks */}
        {beatTicks.map((tick, i) => (
          <div
            key={i}
            className={
              tick.isDownbeat
                ? "absolute bottom-0 w-px bg-muted-foreground/30"
                : "absolute bottom-0 w-px bg-muted-foreground/10"
            }
            style={{
              left: `${tick.percent}%`,
              height: tick.isDownbeat ? "100%" : "40%",
            }}
          />
        ))}

        {/* Bar number labels */}
        {bars.map(
          (bar) =>
            // Only show labels when there's enough space
            bar.barNum % (bars.length > 60 ? 4 : bars.length > 30 ? 2 : 1) ===
              (bars.length > 60 ? 0 : bars.length > 30 ? 0 : 0) && (
              <span
                key={bar.barNum}
                className="absolute top-0 text-[9px] tabular-nums text-muted-foreground/60"
                style={{ left: `${bar.percent}%`, transform: "translateX(2px)" }}
              >
                {bar.barNum}
              </span>
            )
        )}
      </div>
    </div>
  );
}
