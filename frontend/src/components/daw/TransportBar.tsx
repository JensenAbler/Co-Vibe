/**
 * Transport bar — play/stop controls, MIDI device selector, song metadata,
 * time display, and recording indicator.
 */

import { useCallback } from "react";
import {
  Play,
  Square,
  CircleDot,
} from "lucide-react";
import { cn } from "@/components/ui/utils";
import { useTransportStore } from "@/store/transport-store";
import { useAgentStore } from "@/store/agent-store";
import { useSessionStore } from "@/store/session-store";
import { initAudioEngine } from "@/audio/audio-engine";
import { getSlotRecorder } from "@/audio/slot-recorder";
import { useMidiDevices } from "@/hooks/use-midi-devices";
import type { SongOutline, Slot } from "@/types/song-outline";

// --- Formatting helpers ---

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBarBeat(
  currentBeat: number,
  downbeats: number[],
  beats: number[],
  timeSignature: { numerator: number }
): string {
  if (beats.length === 0 || currentBeat < 0) return "Bar 1 · Beat 1";

  const currentTime = beats[currentBeat] ?? 0;

  // Find which bar we're in by counting downbeats before current time
  let bar = 1;
  for (const db of downbeats) {
    if (db <= currentTime) bar++;
    else break;
  }
  if (bar > 1) bar--; // Adjust for zero-crossing

  // Find beat within bar
  let barStartBeatIdx = 0;
  for (let i = 0; i < beats.length; i++) {
    const isDownbeat = downbeats.some(
      (db) => Math.abs(db - beats[i]) < 0.01
    );
    if (isDownbeat && beats[i] <= currentTime) {
      barStartBeatIdx = i;
    }
  }
  const beatInBar = ((currentBeat - barStartBeatIdx) % timeSignature.numerator) + 1;

  return `Bar ${bar} · Beat ${beatInBar}`;
}

// --- Component ---

interface TransportBarProps {
  outline: SongOutline;
  currentSlot: Slot | null;
}

export function TransportBar({ outline, currentSlot }: TransportBarProps) {
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const position = useTransportStore((s) => s.position);
  const currentBeat = useTransportStore((s) => s.currentBeat);
  const agentState = useAgentStore((s) => s.state);
  const currentChord = useAgentStore((s) => s.current_chord);

  const {
    devices: midiDevices,
    selectedId: midiSelectedId,
    select: selectMidi,
    isSupported: midiSupported,
  } = useMidiDevices();

  const { key, tempo, time_signature } = outline;

  const handlePlay = useCallback(async () => {
    if (!outline || isPlaying) return;
    await initAudioEngine();
    useAgentStore.getState().startPerformance(outline);
    useTransportStore.getState().play();
  }, [outline, isPlaying]);

  const handleStop = useCallback(() => {
    const recorder = getSlotRecorder();
    if (recorder.isActive()) {
      const recording = recorder.stopRecording();
      if (recording) {
        useSessionStore.getState().addRecording(recording);
        useSessionStore.getState().updateSlotStatus(recording.slot_id, "user-filled");
      }
    }
    useTransportStore.getState().stop();
    useAgentStore.getState().reset();
  }, []);

  const handleStopRecording = useCallback(() => {
    const recorder = getSlotRecorder();
    if (!recorder.isActive()) return;
    const recording = recorder.stopRecording();
    if (recording) {
      useSessionStore.getState().addRecording(recording);
      useSessionStore.getState().updateSlotStatus(recording.slot_id, "user-filled");
      useAgentStore.getState().onRecordingCompleted(outline);
    }
  }, [outline]);

  return (
    <header className="flex h-12 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold">Co Vibe</h1>

        {/* Transport buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleStop}
            title="Stop"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded hover:bg-secondary/80",
              isPlaying ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <Square className="h-3.5 w-3.5" />
          </button>

          {agentState === "recording" ? (
            <button
              onClick={handleStopRecording}
              title="Finish recording"
              className="flex h-7 items-center gap-1 rounded bg-red-600 px-2.5 text-xs font-medium text-white hover:bg-red-700"
            >
              <CircleDot className="h-3 w-3 animate-pulse" />
              Done
            </button>
          ) : (
            <button
              onClick={handlePlay}
              disabled={isPlaying}
              title="Play"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded",
                isPlaying
                  ? "text-primary/50"
                  : "text-primary hover:bg-secondary/80"
              )}
            >
              <Play className="h-3.5 w-3.5 fill-current" />
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
          <span className="text-[10px] text-muted-foreground">No MIDI</span>
        )}

        {/* Time display */}
        {isPlaying && (
          <span className="tabular-nums text-xs text-muted-foreground">
            {formatTime(position)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {/* Recording indicator */}
        {agentState === "recording" && (
          <span className="flex items-center gap-1 text-red-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            REC
          </span>
        )}

        {currentChord && (
          <span className="font-semibold text-foreground">{currentChord}</span>
        )}
        <span>{Math.round(tempo.bpm)} BPM</span>
        <span>
          {key.tonic} {key.mode}
        </span>
        <span>
          {time_signature.numerator}/{time_signature.denominator}
        </span>
        {isPlaying && (
          <span className="tabular-nums">
            {formatBarBeat(
              currentBeat,
              outline.downbeats,
              outline.beats,
              time_signature
            )}
          </span>
        )}
      </div>
    </header>
  );
}
