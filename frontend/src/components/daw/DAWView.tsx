/**
 * Main DAW (Digital Audio Workstation) view — the performance interface.
 *
 * Composes TransportBar, TimelineRuler, TrackRow, and agent prompt footer.
 * Manages audio engine initialization, MIDI wiring, and keyboard shortcuts.
 */

import { useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { cn } from "@/components/ui/utils";
import { useSessionStore } from "@/store/session-store";
import { useTransportStore } from "@/store/transport-store";
import { useAgentStore } from "@/store/agent-store";
import { initAudioEngine, getAudioEngine } from "@/audio/audio-engine";
import { getMidiInput } from "@/audio/midi-input";
import { getSlotRecorder } from "@/audio/slot-recorder";
import { useAutoSave } from "@/hooks/use-auto-save";
import { TransportBar } from "./TransportBar";
import { TimelineRuler } from "./TimelineRuler";
import { TrackRow } from "./TrackRow";
import type { SectionLabel, Slot } from "@/types/song-outline";

// --- Constants ---

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

const TRACK_STEM_MAP: Record<string, string> = {
  Melody: "vocals",
  Chords: "other",
  Bass: "bass",
  Drums: "drums",
  Pad: "other",
};

const TRACK_LABELS = ["Melody", "Chords", "Bass", "Drums", "Pad"] as const;

// --- Agent prompt text ---

function getAgentPromptText(
  agentState: string,
  currentSlot: Slot | null,
  currentChord: string | null,
  outline: { sections: { id: string; label: string }[] }
): string {
  switch (agentState) {
    case "idle":
      return "Press Play to begin the co-performance.";
    case "playing_intro":
      return "Listening to the intro...";
    case "prompting": {
      if (!currentSlot) return "Waiting for next slot...";
      const sectionLabel =
        currentSlot.section_ids.length > 0
          ? outline.sections.find((s) => s.id === currentSlot.section_ids[0])
              ?.label ?? ""
          : "";
      const chordHint = currentChord ? ` (${currentChord})` : "";
      return `Play a ${currentSlot.track_name} line over ${sectionLabel}${chordHint}`;
    }
    case "recording":
      return `Recording ${currentSlot?.track_name ?? ""}...`;
    case "reviewing":
      return "Nice! Moving to the next part...";
    case "agent_filling":
      return `Agent is filling ${currentSlot?.track_name ?? ""}...`;
    case "completing":
      return "Wrapping up...";
    case "finished":
      return "Performance complete!";
    default:
      return "";
  }
}

// --- Component ---

export function DAWView() {
  const [, navigate] = useLocation();
  const outline = useSessionStore((s) => s.outline);
  const recordings = useSessionStore((s) => s.recordings);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const position = useTransportStore((s) => s.position);
  const agentState = useAgentStore((s) => s.state);
  const currentSlotId = useAgentStore((s) => s.current_slot_id);
  const currentChord = useAgentStore((s) => s.current_chord);

  const initDoneRef = useRef(false);

  // Auto-save on recording changes
  useAutoSave();

  // Redirect to upload if no outline is loaded
  useEffect(() => {
    if (!outline) navigate("/");
  }, [outline, navigate]);

  // Initialize audio engine and load stems
  useEffect(() => {
    if (!outline || initDoneRef.current) return;
    initDoneRef.current = true;

    const setup = async () => {
      const engine = await initAudioEngine();
      engine.setOutline(outline);

      const stemUrls: Record<string, string> = {};
      const stemNames = ["vocals", "drums", "bass", "other"] as const;
      for (const name of stemNames) {
        const outlinePath = outline.stems[name as keyof typeof outline.stems];
        if (outlinePath) {
          stemUrls[name] = outlinePath;
        }
      }

      if (Object.keys(stemUrls).length > 0) {
        try {
          await engine.loadStems(stemUrls);
        } catch (err) {
          console.warn("Failed to load some stems:", err);
        }
      }
      useTransportStore.getState().setStemsReady(true);
    };

    setup();
  }, [outline]);

  // Wire MIDI input to live synth + slot recorder
  useEffect(() => {
    const midi = getMidiInput();
    const recorder = getSlotRecorder();

    const unsub = midi.onNote((note, velocity, isNoteOn) => {
      const engine = getAudioEngine();
      const synth = engine.getLiveSynth();
      const agent = useAgentStore.getState();

      if (isNoteOn) {
        synth?.noteOn(note, velocity);

        if (agent.state === "prompting" && agent.current_slot_id) {
          const slot = outline?.slots.find(
            (s) => s.id === agent.current_slot_id
          );
          if (slot) {
            recorder.startRecording(slot.id, slot.track_name, engine);
            useAgentStore.getState().onRecordingStarted();
          }
        }

        if (recorder.isActive()) {
          recorder.handleNoteOn(note, velocity);
        }
      } else {
        synth?.noteOff(note);
        if (recorder.isActive()) {
          recorder.handleNoteOff(note);
        }
      }
    });

    return () => unsub();
  }, [outline]);

  // Handle stop recording
  const handleStopRecording = useCallback(() => {
    const recorder = getSlotRecorder();
    if (!recorder.isActive() || !outline) return;
    const recording = recorder.stopRecording();
    if (recording) {
      useSessionStore.getState().addRecording(recording);
      useSessionStore
        .getState()
        .updateSlotStatus(recording.slot_id, "user-filled");
      useAgentStore.getState().onRecordingCompleted(outline);
    }
  }, [outline]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (agentState === "recording") {
          handleStopRecording();
        } else if (isPlaying) {
          // Stop
          const recorder = getSlotRecorder();
          if (recorder.isActive()) {
            const recording = recorder.stopRecording();
            if (recording && outline) {
              useSessionStore.getState().addRecording(recording);
              useSessionStore
                .getState()
                .updateSlotStatus(recording.slot_id, "user-filled");
            }
          }
          useTransportStore.getState().stop();
          useAgentStore.getState().reset();
        } else if (outline) {
          // Play
          initAudioEngine().then(() => {
            useAgentStore.getState().startPerformance(outline);
            useTransportStore.getState().play();
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, agentState, outline, handleStopRecording]);

  if (!outline) return null;

  const totalDuration =
    getAudioEngine().getDuration() || outline.source_track.duration || 1;
  const playheadPercent = (position / totalDuration) * 100;

  const currentSlot = currentSlotId
    ? outline.slots.find((s) => s.id === currentSlotId) ?? null
    : null;

  // Build recording lookup map
  const recordingMap = new Map(recordings.map((r) => [r.slot_id, r]));

  return (
    <div className="flex min-h-screen flex-col">
      {/* Transport bar */}
      <TransportBar outline={outline} currentSlot={currentSlot} />

      {/* Timeline + Tracks area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Timeline ruler */}
        <TimelineRuler outline={outline} totalDuration={totalDuration} />

        {/* Section markers (proportional widths) */}
        <div className="relative flex h-8 items-center border-b bg-card/50">
          <div className="w-32 shrink-0" />
          <div className="relative flex flex-1 items-center gap-px px-1">
            {outline.sections.map((section) => {
              const colors =
                SECTION_COLORS[section.label] ?? SECTION_COLORS.intro;
              const widthPercent =
                ((section.end_time - section.start_time) / totalDuration) * 100;
              return (
                <div
                  key={section.id}
                  className={`flex items-center justify-center rounded-sm py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}
                  style={{ width: `${widthPercent}%`, minWidth: 0 }}
                >
                  <span className="truncate px-1">
                    {section.label.charAt(0).toUpperCase() +
                      section.label.slice(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Track rows */}
        <div className="relative flex-1 overflow-y-auto">
          {TRACK_LABELS.map((trackLabel) => {
            const stemName = TRACK_STEM_MAP[trackLabel];
            const trackNameLower = trackLabel.toLowerCase();
            const slot = outline.slots.find(
              (s) => s.track_name === trackNameLower
            );
            const recording = slot ? recordingMap.get(slot.id) : undefined;
            const isActiveSlot = slot?.id === currentSlotId;

            return (
              <TrackRow
                key={trackLabel}
                trackLabel={trackLabel}
                stemName={stemName}
                slot={slot}
                recording={recording}
                isActiveSlot={isActiveSlot}
                agentState={agentState}
                outline={outline}
                totalDuration={totalDuration}
              />
            );
          })}

          {/* Playhead overlay */}
          {isPlaying && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-10"
              style={{ left: "8rem", right: 0 }}
            >
              <div
                className="absolute top-0 bottom-0 w-px bg-primary"
                style={{ left: `${playheadPercent}%` }}
              />
            </div>
          )}
        </div>
      </main>

      {/* Agent prompt area */}
      <footer className="flex h-16 items-center justify-center border-t bg-card px-4">
        <p
          className={cn(
            "text-sm",
            agentState === "recording"
              ? "font-medium text-red-400"
              : agentState === "finished"
                ? "font-medium text-green-400"
                : "text-muted-foreground"
          )}
        >
          {getAgentPromptText(agentState, currentSlot, currentChord, outline)}
          {agentState === "recording" && (
            <span className="ml-2 text-xs text-muted-foreground">
              (press Space to finish)
            </span>
          )}
        </p>
      </footer>
    </div>
  );
}
