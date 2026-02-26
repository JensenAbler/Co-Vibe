/**
 * Main DAW (Digital Audio Workstation) view — the performance interface.
 *
 * Displays the song outline as a timeline with tracks, section markers,
 * a playhead, and agent prompts. Wired to the audio engine, MIDI input,
 * and agent state machine.
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
import { useMidiDevices } from "@/hooks/use-midi-devices";
import { getStemUrl } from "@/api/analysis-client";
import type { SectionLabel, Slot } from "@/types/song-outline";

// --- Section color mapping ---

const SECTION_COLORS: Record<SectionLabel, { bg: string; text: string; fill: string }> = {
  intro: { bg: "bg-blue-500/20", text: "text-blue-400", fill: "bg-blue-500/30" },
  verse: { bg: "bg-green-500/20", text: "text-green-400", fill: "bg-green-500/30" },
  chorus: { bg: "bg-orange-500/20", text: "text-orange-400", fill: "bg-orange-500/30" },
  bridge: { bg: "bg-purple-500/20", text: "text-purple-400", fill: "bg-purple-500/30" },
  instrumental: { bg: "bg-cyan-500/20", text: "text-cyan-400", fill: "bg-cyan-500/30" },
  solo: { bg: "bg-yellow-500/20", text: "text-yellow-400", fill: "bg-yellow-500/30" },
  outro: { bg: "bg-rose-500/20", text: "text-rose-400", fill: "bg-rose-500/30" },
  break: { bg: "bg-gray-500/20", text: "text-gray-400", fill: "bg-gray-500/30" },
};

// Map track label to stem name for mute/solo routing
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
      const sectionLabel = currentSlot.section_ids.length > 0
        ? outline.sections.find((s) => s.id === currentSlot.section_ids[0])?.label ?? ""
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
      return "Performance complete! 🎵";
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
  const currentBeat = useTransportStore((s) => s.currentBeat);
  const stemsReady = useTransportStore((s) => s.stemsReady);
  const mutedTracks = useTransportStore((s) => s.mutedTracks);
  const soloedTracks = useTransportStore((s) => s.soloedTracks);
  const agentState = useAgentStore((s) => s.state);
  const currentSlotId = useAgentStore((s) => s.current_slot_id);
  const currentChord = useAgentStore((s) => s.current_chord);

  const { devices: midiDevices, selectedId: midiSelectedId, select: selectMidi, isSupported: midiSupported } = useMidiDevices();

  const midiUnsubRef = useRef<(() => void) | null>(null);
  const initDoneRef = useRef(false);

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

      // Build stem URLs — try outline.stems first, fall back to API
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
          useTransportStore.getState().setStemsReady(true);
        } catch (err) {
          console.warn("Failed to load some stems:", err);
          // Allow playback even if stems fail
          useTransportStore.getState().setStemsReady(true);
        }
      } else {
        // No stems available — still allow the UI to function
        useTransportStore.getState().setStemsReady(true);
      }
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
        // Live synth preview
        synth?.noteOn(note, velocity);

        // If agent is prompting, start recording on first note
        if (agent.state === "prompting" && agent.current_slot_id) {
          const slot = outline?.slots.find((s) => s.id === agent.current_slot_id);
          if (slot) {
            recorder.startRecording(slot.id, slot.track_name, engine);
            useAgentStore.getState().onRecordingStarted();
          }
        }

        // Feed to recorder if active
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

    midiUnsubRef.current = unsub;
    return () => {
      unsub();
      midiUnsubRef.current = null;
    };
  }, [outline]);

  // Handle play
  const handlePlay = useCallback(async () => {
    if (!outline) return;

    // Ensure AudioContext is resumed (user gesture)
    await initAudioEngine();

    if (!isPlaying) {
      useAgentStore.getState().startPerformance(outline);
      useTransportStore.getState().play();
    }
  }, [outline, isPlaying]);

  // Handle stop
  const handleStop = useCallback(() => {
    // If recording, complete it first
    const recorder = getSlotRecorder();
    if (recorder.isActive()) {
      const recording = recorder.stopRecording();
      if (recording && outline) {
        useSessionStore.getState().addRecording(recording);
        useSessionStore.getState().updateSlotStatus(recording.slot_id, "user-filled");
      }
    }

    useTransportStore.getState().stop();
    useAgentStore.getState().reset();
  }, [outline]);

  // Handle stop recording (spacebar or button)
  const handleStopRecording = useCallback(() => {
    const recorder = getSlotRecorder();
    if (!recorder.isActive() || !outline) return;

    const recording = recorder.stopRecording();
    if (recording) {
      useSessionStore.getState().addRecording(recording);
      useSessionStore.getState().updateSlotStatus(recording.slot_id, "user-filled");
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
          handleStop();
        } else {
          handlePlay();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, agentState, handlePlay, handleStop, handleStopRecording]);

  if (!outline) return null;

  const { key, tempo, time_signature } = outline;
  const totalDuration = getAudioEngine().getDuration() || outline.source_track.duration || 1;
  const playheadPercent = (position / totalDuration) * 100;

  // Find current slot object
  const currentSlot = currentSlotId
    ? outline.slots.find((s) => s.id === currentSlotId) ?? null
    : null;

  // Set of filled slot IDs
  const filledSlotIds = new Set(recordings.map((r) => r.slot_id));

  return (
    <div className="flex min-h-screen flex-col">
      {/* Transport bar */}
      <header className="flex h-12 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold">Co Vibe</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={handleStop}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium hover:bg-secondary/80",
                isPlaying ? "bg-secondary" : "bg-secondary/50 text-muted-foreground"
              )}
            >
              Stop
            </button>
            {agentState === "recording" ? (
              <button
                onClick={handleStopRecording}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                ■ Done
              </button>
            ) : (
              <button
                onClick={handlePlay}
                disabled={isPlaying}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium",
                  isPlaying
                    ? "bg-primary/50 text-primary-foreground/50"
                    : "bg-primary text-primary-foreground hover:bg-primary/80"
                )}
              >
                Play
              </button>
            )}
          </div>

          {/* MIDI device selector */}
          {midiSupported && midiDevices.length > 0 && (
            <select
              value={midiSelectedId ?? ""}
              onChange={(e) => selectMidi(e.target.value)}
              className="rounded border bg-secondary px-2 py-0.5 text-[10px] text-foreground"
            >
              {midiDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          {midiSupported && midiDevices.length === 0 && (
            <span className="text-[10px] text-muted-foreground">No MIDI device</span>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {currentChord && (
            <span className="font-semibold text-foreground">{currentChord}</span>
          )}
          <span>{Math.round(tempo.bpm)} BPM</span>
          <span>{key.tonic} {key.mode}</span>
          <span>{time_signature.numerator}/{time_signature.denominator}</span>
          {isPlaying && (
            <span className="tabular-nums">
              Beat {currentBeat + 1} / {outline.beats.length}
            </span>
          )}
        </div>
      </header>

      {/* Timeline + Tracks area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Section markers (proportional widths) + playhead */}
        <div className="relative flex h-8 items-center border-b bg-card/50">
          <div className="w-32 shrink-0" /> {/* spacer for track labels column */}
          <div className="relative flex flex-1 items-center gap-px px-1">
            {outline.sections.map((section) => {
              const colors = SECTION_COLORS[section.label] ?? SECTION_COLORS.intro;
              const widthPercent = ((section.end_time - section.start_time) / totalDuration) * 100;
              return (
                <div
                  key={section.id}
                  className={`flex items-center justify-center rounded-sm py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}
                  style={{ width: `${widthPercent}%`, minWidth: 0 }}
                >
                  <span className="truncate px-1">
                    {section.label.charAt(0).toUpperCase() + section.label.slice(1)}
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
            const isMuted = mutedTracks.has(stemName);
            const isSoloed = soloedTracks.has(stemName);
            const trackNameLower = trackLabel.toLowerCase();

            // Find the slot for this track
            const slot = outline.slots.find(
              (s) => s.track_name === trackNameLower
            );
            const isFilled = slot ? filledSlotIds.has(slot.id) || slot.status !== "empty" : false;
            const isActiveSlot = slot?.id === currentSlotId;

            return (
              <div
                key={trackLabel}
                className={cn(
                  "flex h-16 items-center border-b border-border/50",
                  isActiveSlot && agentState === "prompting" && "ring-1 ring-inset ring-primary/50",
                  isActiveSlot && agentState === "recording" && "ring-2 ring-inset ring-red-500/70"
                )}
              >
                {/* Track label + controls */}
                <div className="flex w-32 shrink-0 items-center justify-between border-r px-3">
                  <span className="text-xs font-medium">{trackLabel}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => useTransportStore.getState().toggleMute(stemName)}
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
                      onClick={() => useTransportStore.getState().toggleSolo(stemName)}
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

                {/* Track content area (timeline with sections) */}
                <div className="relative flex flex-1 items-center gap-px px-1">
                  {slot && outline.sections.map((section) => {
                    const isSlotSection = slot.section_ids.includes(section.id);
                    const colors = SECTION_COLORS[section.label] ?? SECTION_COLORS.intro;
                    const widthPercent = ((section.end_time - section.start_time) / totalDuration) * 100;

                    return (
                      <div
                        key={section.id}
                        className={cn(
                          "h-10 rounded-sm",
                          isSlotSection && isFilled
                            ? colors.fill
                            : isSlotSection
                              ? "border border-dashed border-muted-foreground/30"
                              : "border border-dashed border-muted-foreground/10"
                        )}
                        style={{ width: `${widthPercent}%`, minWidth: 0 }}
                      />
                    );
                  })}
                  {!slot && (
                    <div className="h-10 flex-1 rounded-sm border border-dashed border-muted-foreground/10" />
                  )}
                </div>
              </div>
            );
          })}

          {/* Playhead overlay (spans entire tracks area) */}
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
