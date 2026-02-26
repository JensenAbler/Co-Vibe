/**
 * Single track row — track label, mute/solo/volume controls,
 * and timeline cells with beat grid and slot visualization.
 */

import * as Slider from "@radix-ui/react-slider";
import { cn } from "@/components/ui/utils";
import { useTransportStore } from "@/store/transport-store";
import { MiniPianoRoll } from "./MiniPianoRoll";
import type { SongOutline, Slot, SectionLabel } from "@/types/song-outline";
import type { SlotRecording } from "@/types/session";
import type { AgentState } from "@/types/agent";

const SECTION_COLORS: Record<SectionLabel, { bg: string; fill: string; note: string }> = {
  intro: { bg: "bg-blue-500/20", fill: "bg-blue-500/30", note: "bg-blue-400" },
  verse: { bg: "bg-green-500/20", fill: "bg-green-500/30", note: "bg-green-400" },
  chorus: { bg: "bg-orange-500/20", fill: "bg-orange-500/30", note: "bg-orange-400" },
  bridge: { bg: "bg-purple-500/20", fill: "bg-purple-500/30", note: "bg-purple-400" },
  instrumental: { bg: "bg-cyan-500/20", fill: "bg-cyan-500/30", note: "bg-cyan-400" },
  solo: { bg: "bg-yellow-500/20", fill: "bg-yellow-500/30", note: "bg-yellow-400" },
  outro: { bg: "bg-rose-500/20", fill: "bg-rose-500/30", note: "bg-rose-400" },
  break: { bg: "bg-gray-500/20", fill: "bg-gray-500/30", note: "bg-gray-400" },
};

interface TrackRowProps {
  trackLabel: string;
  stemName: string;
  slot: Slot | undefined;
  recording: SlotRecording | undefined;
  isActiveSlot: boolean;
  agentState: AgentState;
  outline: SongOutline;
  totalDuration: number;
}

export function TrackRow({
  trackLabel,
  stemName,
  slot,
  recording,
  isActiveSlot,
  agentState,
  outline,
  totalDuration,
}: TrackRowProps) {
  const mutedTracks = useTransportStore((s) => s.mutedTracks);
  const soloedTracks = useTransportStore((s) => s.soloedTracks);
  const trackVolumes = useTransportStore((s) => s.trackVolumes);

  const isMuted = mutedTracks.has(stemName);
  const isSoloed = soloedTracks.has(stemName);
  const volume = trackVolumes[stemName] ?? 1;
  const isFilled = slot
    ? (recording != null) || slot.status !== "empty"
    : false;

  // Build downbeat set for beat grid rendering
  const downbeatSet = new Set(
    outline.downbeats.map((t) => Math.round(t * 1000))
  );

  return (
    <div
      className={cn(
        "flex h-16 items-center border-b border-border/50",
        isActiveSlot &&
          agentState === "prompting" &&
          "ring-1 ring-inset ring-primary/50",
        isActiveSlot &&
          agentState === "recording" &&
          "ring-2 ring-inset ring-red-500/70 animate-pulse"
      )}
    >
      {/* Track label + controls */}
      <div className="flex w-32 shrink-0 flex-col justify-center border-r px-3 py-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">{trackLabel}</span>
          <div className="flex gap-1">
            <button
              onClick={() =>
                useTransportStore.getState().toggleMute(stemName)
              }
              className={cn(
                "h-5 w-5 rounded text-[10px] font-bold",
                isMuted
                  ? "bg-yellow-500/80 text-yellow-950"
                  : "text-muted-foreground hover:bg-secondary"
              )}
            >
              M
            </button>
            <button
              onClick={() =>
                useTransportStore.getState().toggleSolo(stemName)
              }
              className={cn(
                "h-5 w-5 rounded text-[10px] font-bold",
                isSoloed
                  ? "bg-blue-500/80 text-blue-950"
                  : "text-muted-foreground hover:bg-secondary"
              )}
            >
              S
            </button>
          </div>
        </div>

        {/* Volume slider */}
        <Slider.Root
          className="relative mt-1 flex h-3 w-full touch-none items-center"
          value={[volume]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={([v]) =>
            useTransportStore.getState().setVolume(stemName, v)
          }
        >
          <Slider.Track className="relative h-[3px] flex-1 rounded-full bg-secondary">
            <Slider.Range className="absolute h-full rounded-full bg-muted-foreground/40" />
          </Slider.Track>
          <Slider.Thumb className="block h-2.5 w-2.5 rounded-full border border-muted-foreground/40 bg-background shadow-sm focus:outline-none" />
        </Slider.Root>
      </div>

      {/* Track content area (timeline with sections + beat grid) */}
      <div className="relative flex flex-1 items-center gap-px px-1">
        {/* Beat grid overlay */}
        {outline.beats.map((beatTime, i) => {
          const isDownbeat = downbeatSet.has(Math.round(beatTime * 1000));
          const percent = (beatTime / totalDuration) * 100;
          return (
            <div
              key={i}
              className={cn(
                "pointer-events-none absolute top-0 bottom-0 w-px",
                isDownbeat
                  ? "bg-muted-foreground/15"
                  : "bg-muted-foreground/5"
              )}
              style={{ left: `${percent}%` }}
            />
          );
        })}

        {/* Section cells */}
        {slot &&
          outline.sections.map((section) => {
            const isSlotSection = slot.section_ids.includes(section.id);
            const colors =
              SECTION_COLORS[section.label] ?? SECTION_COLORS.intro;
            const widthPercent =
              ((section.end_time - section.start_time) / totalDuration) * 100;
            const sectionDuration = section.end_time - section.start_time;

            return (
              <div
                key={section.id}
                className={cn(
                  "relative h-10 rounded-sm",
                  isSlotSection && isFilled
                    ? colors.fill
                    : isSlotSection
                      ? "border border-dashed border-muted-foreground/30"
                      : "border border-dashed border-muted-foreground/10"
                )}
                style={{ width: `${widthPercent}%`, minWidth: 0 }}
              >
                {/* Mini piano roll for filled slots */}
                {isSlotSection && isFilled && recording && (
                  <MiniPianoRoll
                    recording={recording}
                    sectionDuration={sectionDuration}
                    colorClass={colors.note}
                  />
                )}
              </div>
            );
          })}

        {!slot && (
          <div className="h-10 flex-1 rounded-sm border border-dashed border-muted-foreground/10" />
        )}
      </div>
    </div>
  );
}
