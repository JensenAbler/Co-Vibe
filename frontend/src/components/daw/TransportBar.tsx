/**
 * Transport bar — play/stop controls, MIDI device selector, song metadata,
 * time display, recording indicator, save/export/sessions menu.
 */

import { useCallback, useState } from "react";
import {
  Play,
  Square,
  CircleDot,
  Save,
  Download,
  FolderOpen,
  Check,
  Mic,
  MicOff,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/components/ui/utils";
import { useTransportStore } from "@/store/transport-store";
import { useAgentStore } from "@/store/agent-store";
import { useSessionStore } from "@/store/session-store";
import { initAudioEngine } from "@/audio/audio-engine";
import { getSlotRecorder } from "@/audio/slot-recorder";
import { getConductor } from "@/conductor/conductor";
import { useConductorStore } from "@/store/conductor-store";
import { useMidiDevices } from "@/hooks/use-midi-devices";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { loadSession } from "@/lib/db";
import { exportCovibe, downloadBlob } from "@/lib/covibe-file";
import { SessionBrowser } from "@/components/sessions/SessionBrowser";
import { ClaudeTokenBar } from "@/components/daw/ClaudeTokenBar";
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
  const stemsReady = useTransportStore((s) => s.stemsReady);
  const agentState = useAgentStore((s) => s.state);
  const currentChord = useAgentStore((s) => s.current_chord);

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionName = useSessionStore((s) => s.sessionName);
  const isDirty = useSessionStore((s) => s.isDirty);

  const [sessionBrowserOpen, setSessionBrowserOpen] = useState(false);
  const [showSavedFlash, setShowSavedFlash] = useState(false);

  const {
    devices: midiDevices,
    selectedId: midiSelectedId,
    select: selectMidi,
    isSupported: midiSupported,
  } = useMidiDevices();

  const {
    isSupported: voiceSupported,
    isEnabled: vocoderEnabled,
    enable: enableVocoder,
    disable: disableVocoder,
  } = useVoiceInput();

  const { key, tempo, time_signature } = outline;

  const handlePlay = useCallback(async () => {
    if (!outline || isPlaying || !stemsReady) return;
    await initAudioEngine();
    useAgentStore.getState().startPerformance();
    useConductorStore.getState().setPhase("performing");
    useTransportStore.getState().play();

    // Start planning the first section
    const conductor = getConductor();
    conductor?.planSection(0);
  }, [outline, isPlaying, stemsReady]);

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
      useAgentStore.getState().onRecordingCompleted();
    }
  }, [outline]);

  const handleSave = useCallback(async () => {
    await useSessionStore.getState().save();
    setShowSavedFlash(true);
    setTimeout(() => setShowSavedFlash(false), 2000);
  }, []);

  const handleExport = useCallback(async () => {
    if (!sessionId) return;
    const session = await loadSession(sessionId);
    if (!session) return;
    const blob = exportCovibe(session);
    const safeName = sessionName.replace(/[^a-zA-Z0-9_-]/g, "_");
    downloadBlob(blob, `${safeName}.covibe`);
  }, [sessionId, sessionName]);

  return (
    <>
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

            {agentState === "human_recording" ? (
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
                disabled={isPlaying || !stemsReady}
                title={stemsReady ? "Play" : "Loading stems..."}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded",
                  isPlaying || !stemsReady
                    ? "text-primary/50"
                    : "text-primary hover:bg-secondary/80"
                )}
              >
                <Play className="h-3.5 w-3.5 fill-current" />
              </button>
            )}
          </div>

          {/* Save / Export / Sessions dropdown */}
          {sessionId && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleSave}
                title="Save session"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded hover:bg-secondary/80",
                  showSavedFlash
                    ? "text-green-400"
                    : isDirty
                      ? "text-foreground"
                      : "text-muted-foreground"
                )}
              >
                {showSavedFlash ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    title="Session menu"
                    className="flex h-7 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                  >
                    <span className="max-w-[120px] truncate text-[10px]">
                      {sessionName}
                    </span>
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 12 12"
                      fill="currentColor"
                    >
                      <path d="M3 5l3 3 3-3" />
                    </svg>
                  </button>
                </DropdownMenu.Trigger>

                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="start"
                    sideOffset={4}
                    className="z-50 min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                  >
                    <DropdownMenu.Item
                      onClick={handleSave}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent"
                    >
                      <Save className="h-3 w-3" />
                      Save
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onClick={handleExport}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent"
                    >
                      <Download className="h-3 w-3" />
                      Export .covibe
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border" />
                    <DropdownMenu.Item
                      onClick={() => setSessionBrowserOpen(true)}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent"
                    >
                      <FolderOpen className="h-3 w-3" />
                      All Sessions...
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          )}

          {/* Saved flash text (outside dropdown for quick glance) */}
          {showSavedFlash && (
            <span className="text-[10px] text-green-400">Saved</span>
          )}

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

          {/* Vocoder toggle */}
          {voiceSupported && (
            <button
              onClick={() =>
                vocoderEnabled ? disableVocoder() : enableVocoder()
              }
              title={vocoderEnabled ? "Disable vocoder" : "Enable vocoder"}
              className={cn(
                "flex h-7 items-center gap-1 rounded px-2 text-[10px]",
                vocoderEnabled
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-secondary/80"
              )}
            >
              {vocoderEnabled ? (
                <Mic className="h-3 w-3" />
              ) : (
                <MicOff className="h-3 w-3" />
              )}
              <span>Vocoder</span>
            </button>
          )}

          {/* Claude token */}
          <ClaudeTokenBar />

          {/* Time display */}
          {isPlaying && (
            <span className="tabular-nums text-xs text-muted-foreground">
              {formatTime(position)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {/* Recording indicator */}
          {agentState === "human_recording" && (
            <span className="flex items-center gap-1 text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              REC
            </span>
          )}

          {/* Dirty indicator */}
          {isDirty && !showSavedFlash && (
            <span className="text-[10px] text-muted-foreground/50">
              Unsaved
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

      {/* Session browser modal */}
      <SessionBrowser
        open={sessionBrowserOpen}
        onOpenChange={setSessionBrowserOpen}
      />
    </>
  );
}
