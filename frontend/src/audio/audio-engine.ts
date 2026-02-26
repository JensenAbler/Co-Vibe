/**
 * Core audio engine — manages AudioContext, stem playback, transport clock,
 * MIDI routing, and slot playback.
 *
 * This is a plain TypeScript singleton, not a React component.
 * It communicates with React through Zustand stores.
 */

import { fetchAndDecode, findBeatIndex } from "./utils";
import { SimpleSynth } from "./simple-synth";
import { useTransportStore } from "@/store/transport-store";
import { useAgentStore } from "@/store/agent-store";
import { useSessionStore } from "@/store/session-store";
import type { SongOutline } from "@/types/song-outline";
import type { SlotRecording } from "@/types/session";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Stem playback
  private stemBuffers = new Map<string, AudioBuffer>();
  private stemSources = new Map<string, AudioBufferSourceNode>();
  private stemGains = new Map<string, GainNode>();

  // Synth for live MIDI preview
  private liveSynth: SimpleSynth | null = null;

  // Synth tracks for slot playback
  private slotSynths: SimpleSynth[] = [];

  // Transport state
  private playStartedAt = 0; // ctx.currentTime when play() was called
  private offset = 0; // seek offset in song-seconds
  private playing = false;
  private rafId: number | null = null;

  // Beat tracking
  private beats: number[] = [];
  private lastBeatIndex = -1;

  // Outline reference
  private outline: SongOutline | null = null;

  // Mute/Solo state (mirrored from transport-store for audio-thread access)
  private mutedTracks = new Set<string>();
  private soloedTracks = new Set<string>();

  // Duration
  private duration = 0;

  // Loading state
  private stemsLoaded = false;

  /**
   * Create or resume the AudioContext. Must be called from a user gesture.
   */
  async init(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.liveSynth = new SimpleSynth(this.ctx, this.masterGain);
    }

    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  /**
   * Load and decode stem audio files.
   */
  async loadStems(stemUrls: Record<string, string>): Promise<void> {
    if (!this.ctx) throw new Error("AudioEngine not initialized");

    const entries = Object.entries(stemUrls).filter(([, url]) => url);

    const results = await Promise.allSettled(
      entries.map(async ([name, url]) => {
        const buffer = await fetchAndDecode(this.ctx!, url);
        return [name, buffer] as const;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const [name, buffer] = result.value;
        this.stemBuffers.set(name, buffer);
      }
    }

    // Determine duration from the longest stem
    let maxDuration = 0;
    for (const buffer of this.stemBuffers.values()) {
      maxDuration = Math.max(maxDuration, buffer.duration);
    }
    this.duration = maxDuration;
    this.stemsLoaded = true;
  }

  /**
   * Set the song outline for beat tracking and agent integration.
   */
  setOutline(outline: SongOutline): void {
    this.outline = outline;
    this.beats = outline.beats;
    if (outline.source_track?.duration) {
      this.duration = Math.max(this.duration, outline.source_track.duration);
    }
  }

  /**
   * Start playback from the current offset.
   */
  play(): void {
    if (!this.ctx || !this.masterGain || this.playing) return;

    this.playing = true;

    // Create and start stem source nodes
    for (const [name, buffer] of this.stemBuffers) {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      // Get or create gain node for this stem
      let gain = this.stemGains.get(name);
      if (!gain) {
        gain = this.ctx.createGain();
        gain.connect(this.masterGain);
        this.stemGains.set(name, gain);
      }
      this.applyGainForTrack(name, gain);

      source.connect(gain);

      // Start all at the same precise time, with offset
      const startTime = this.ctx.currentTime + 0.05;
      source.start(startTime, this.offset);
      source.onended = () => {
        this.stemSources.delete(name);
        // If all stems ended naturally, stop transport
        if (this.stemSources.size === 0 && this.playing) {
          this.stop();
        }
      };

      this.stemSources.set(name, source);
    }

    this.playStartedAt = this.ctx.currentTime + 0.05;

    // Schedule slot recordings for playback
    this.scheduleSlotPlayback();

    // Start the transport clock
    this.lastBeatIndex = findBeatIndex(this.beats, this.offset);
    this.startClock();
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop(): void {
    this.playing = false;
    this.offset = 0;

    // Stop all stem sources
    for (const source of this.stemSources.values()) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // May already be stopped
      }
    }
    this.stemSources.clear();

    // Stop slot synths
    for (const synth of this.slotSynths) {
      synth.stopAll();
    }
    this.slotSynths = [];

    // Stop live synth
    this.liveSynth?.stopAll();

    // Stop clock
    this.stopClock();

    // Reset stores
    useTransportStore.getState().setPosition(0);
    useTransportStore.getState().setCurrentBeat(0);
  }

  /**
   * Get the current playback position in seconds.
   */
  getCurrentTime(): number {
    if (!this.ctx || !this.playing) return this.offset;
    return this.ctx.currentTime - this.playStartedAt + this.offset;
  }

  /**
   * Get the AudioContext (for synths that need to create nodes).
   */
  getContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Get the live preview synth.
   */
  getLiveSynth(): SimpleSynth | null {
    return this.liveSynth;
  }

  /**
   * Check if stems are loaded and ready to play.
   */
  isReady(): boolean {
    return this.stemsLoaded;
  }

  /**
   * Get the total duration of the song.
   */
  getDuration(): number {
    return this.duration;
  }

  /**
   * Check if currently playing.
   */
  isPlaying(): boolean {
    return this.playing;
  }

  // --- Mute / Solo ---

  setMute(trackName: string, muted: boolean): void {
    if (muted) {
      this.mutedTracks.add(trackName);
    } else {
      this.mutedTracks.delete(trackName);
    }
    this.updateAllGains();
  }

  setSolo(trackName: string, solo: boolean): void {
    if (solo) {
      this.soloedTracks.add(trackName);
    } else {
      this.soloedTracks.delete(trackName);
    }
    this.updateAllGains();
  }

  private updateAllGains(): void {
    for (const [name, gain] of this.stemGains) {
      this.applyGainForTrack(name, gain);
    }
  }

  private applyGainForTrack(trackName: string, gain: GainNode): void {
    const hasSolos = this.soloedTracks.size > 0;
    const isMuted = this.mutedTracks.has(trackName);
    const isSoloed = this.soloedTracks.has(trackName);

    let targetGain = 1;
    if (isMuted) {
      targetGain = 0;
    } else if (hasSolos && !isSoloed) {
      targetGain = 0;
    }

    // Smooth gain change to avoid clicks
    if (this.ctx) {
      gain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);
    }
  }

  // --- Slot playback ---

  private scheduleSlotPlayback(): void {
    if (!this.ctx || !this.masterGain || !this.outline) return;

    const recordings = useSessionStore.getState().recordings;
    if (recordings.length === 0) return;

    for (const recording of recordings) {
      // Find the earliest section this slot covers to get the time offset
      const slot = this.outline.slots.find(
        (s) => s.id === recording.slot_id
      );
      if (!slot || slot.section_ids.length === 0) continue;

      const section = this.outline.sections.find(
        (s) => s.id === slot.section_ids[0]
      );
      if (!section) continue;

      // The recording's event times are relative to recording start.
      // Schedule them at the section's start time in the song.
      const sectionOffset = section.start_time - this.offset;
      if (sectionOffset < 0) continue; // Section already passed

      const synth = new SimpleSynth(this.ctx, this.masterGain);
      synth.scheduleRecording(recording, this.playStartedAt + sectionOffset);
      this.slotSynths.push(synth);
    }
  }

  // --- Transport clock ---

  private startClock(): void {
    const tick = () => {
      if (!this.playing) return;

      const position = this.getCurrentTime();

      // Check if we've reached the end
      if (position >= this.duration) {
        this.stop();
        useTransportStore.getState().stop();
        useAgentStore.getState().transition("finished");
        return;
      }

      // Update stores
      useTransportStore.getState().setPosition(position);

      const beatIndex = findBeatIndex(this.beats, position);
      if (beatIndex !== this.lastBeatIndex && beatIndex >= 0) {
        useTransportStore.getState().setCurrentBeat(beatIndex);

        // Notify agent on beat boundary changes
        if (this.outline) {
          useAgentStore.getState().tick(beatIndex, position, this.outline);
        }

        this.lastBeatIndex = beatIndex;
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private stopClock(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // --- Cleanup ---

  dispose(): void {
    this.stop();
    this.liveSynth?.dispose();
    this.stemBuffers.clear();
    this.stemGains.clear();

    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}

// --- Module-level singleton ---

let engineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engineInstance) {
    engineInstance = new AudioEngine();
  }
  return engineInstance;
}

export async function initAudioEngine(): Promise<AudioEngine> {
  const engine = getAudioEngine();
  await engine.init();
  return engine;
}
