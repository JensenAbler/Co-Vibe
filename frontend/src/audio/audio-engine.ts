/**
 * Core audio engine — manages AudioContext, stem playback, transport clock,
 * MIDI routing, and slot playback.
 *
 * This is a plain TypeScript singleton, not a React component.
 * It communicates with React through Zustand stores.
 */

import { fetchAndDecode, findBeatIndex } from "./utils";
import { SimpleSynth } from "./simple-synth";
import { Vocoder } from "./vocoder";
import { CarrierSynth } from "./carrier-synth";
import { getVoiceInput } from "./voice-input";
import { useTransportStore } from "@/store/transport-store";
import { useAgentStore } from "@/store/agent-store";
import { useSessionStore } from "@/store/session-store";
import type { SongOutline } from "@/types/song-outline";
import type { SlotRecording } from "@/types/session";
import type { PerformanceOutline, PerformanceSection } from "@/conductor/performance-outline";
import { findPerformanceSectionIndex } from "@/conductor/performance-outline";

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
  private performanceOutline: PerformanceOutline | null = null;

  // Section change callback (for Conductor integration)
  private onSectionChange: ((fromIndex: number, toIndex: number) => void) | null = null;
  private lastSectionIndex = -1;

  // Original stem duration (for looping)
  private originalStemDuration = 0;

  // Mute/Solo/Volume state (mirrored from transport-store for audio-thread access)
  private mutedTracks = new Set<string>();
  private soloedTracks = new Set<string>();
  private trackVolumes = new Map<string, number>();

  // Duration
  private duration = 0;

  // Loading state
  private stemsLoaded = false;

  // Vocoder
  private vocoder: Vocoder | null = null;
  private carrierSynth: CarrierSynth | null = null;
  private vocoderEnabled = false;

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

    // Update duration from the longest stem, but never overwrite
    // a valid duration (from setOutline) with zero.
    let maxDuration = 0;
    for (const buffer of this.stemBuffers.values()) {
      maxDuration = Math.max(maxDuration, buffer.duration);
    }
    if (maxDuration > 0) {
      this.duration = Math.max(this.duration, maxDuration);
    }
    this.stemsLoaded = true;
  }

  /**
   * Set the song outline for beat tracking and agent integration.
   */
  setOutline(outline: SongOutline): void {
    this.outline = outline;
    this.beats = outline.beats;
    if (outline.source_track?.duration) {
      this.originalStemDuration = outline.source_track.duration;
      this.duration = Math.max(this.duration, outline.source_track.duration);
    }
  }

  /**
   * Set a PerformanceOutline (doubled sections) for the Conductor.
   * Overrides duration, beats, and downbeats with the performance timeline.
   */
  setPerformanceOutline(perfOutline: PerformanceOutline): void {
    this.performanceOutline = perfOutline;
    this.outline = perfOutline.original;
    this.beats = perfOutline.beats;
    this.duration = perfOutline.totalDuration;
    this.originalStemDuration = perfOutline.original.source_track.duration;
  }

  /**
   * Register a callback for section boundary changes.
   * The Conductor uses this to execute plans and trigger planning.
   */
  setOnSectionChange(cb: ((fromIndex: number, toIndex: number) => void) | null): void {
    this.onSectionChange = cb;
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

      // Enable looping when using a performance outline (doubled duration)
      // Stems loop from 0 → original duration so they repeat for the 2x timeline
      if (this.performanceOutline && this.originalStemDuration > 0) {
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = this.originalStemDuration;
      }

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
      const stemOffset = this.performanceOutline
        ? this.offset % this.originalStemDuration  // wrap offset for looped stems
        : this.offset;
      source.start(startTime, stemOffset);

      if (!this.performanceOutline) {
        // Only auto-stop on stem end for non-looped mode
        source.onended = () => {
          this.stemSources.delete(name);
          if (this.stemSources.size === 0 && this.playing) {
            this.stop();
          }
        };
      }

      this.stemSources.set(name, source);
    }

    this.playStartedAt = this.ctx.currentTime + 0.05;

    // Schedule slot recordings for playback
    this.scheduleSlotPlayback();

    // Start the transport clock
    this.lastBeatIndex = findBeatIndex(this.beats, this.offset);
    this.lastSectionIndex = this.performanceOutline
      ? findPerformanceSectionIndex(this.performanceOutline, this.offset)
      : -1;
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
   * Seek to a position in seconds. If playing, restarts from new position.
   */
  seek(time: number): void {
    const clampedTime = Math.max(0, Math.min(time, this.duration));

    if (this.playing) {
      // Stop current sources without resetting offset
      for (const source of this.stemSources.values()) {
        try {
          source.onended = null;
          source.stop();
        } catch {
          // May already be stopped
        }
      }
      this.stemSources.clear();

      for (const synth of this.slotSynths) {
        synth.stopAll();
      }
      this.slotSynths = [];

      this.stopClock();

      // Restart from new position
      this.playing = false;
      this.offset = clampedTime;
      this.play();
    } else {
      this.offset = clampedTime;
    }

    useTransportStore.getState().setPosition(clampedTime);
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

  setVolume(trackName: string, volume: number): void {
    this.trackVolumes.set(trackName, Math.max(0, Math.min(1, volume)));
    const gain = this.stemGains.get(trackName);
    if (gain) {
      this.applyGainForTrack(trackName, gain);
    }
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
    const volume = this.trackVolumes.get(trackName) ?? 1;

    let targetGain = volume;
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
    if (!this.ctx || !this.masterGain) return;

    const recordings = useSessionStore.getState().recordings;
    if (recordings.length === 0) return;

    if (this.performanceOutline) {
      // Performance mode: MIDI event times are absolute in the performance timeline
      // Group by slot_id, prefer user recordings over agent recordings
      const slotMap = new Map<string, SlotRecording>();
      for (const recording of recordings) {
        const existing = slotMap.get(recording.slot_id);
        if (!existing || recording.source === "user") {
          slotMap.set(recording.slot_id, recording);
        }
      }

      for (const recording of slotMap.values()) {
        if (recording.midi_events.length === 0) continue;

        // Events have absolute times — schedule relative to play start
        const synth = new SimpleSynth(this.ctx, this.masterGain!);
        for (const event of recording.midi_events) {
          const eventTime = event.time - this.offset;
          if (eventTime < 0) continue; // Event already passed

          const scheduleAt = this.playStartedAt + eventTime;
          synth.scheduleNote(
            event.note,
            event.velocity,
            scheduleAt,
            event.duration
          );
        }
        this.slotSynths.push(synth);
      }
    } else if (this.outline) {
      // Legacy mode: events relative to recording start, scheduled at section start
      for (const recording of recordings) {
        const slot = this.outline.slots.find(
          (s) => s.id === recording.slot_id
        );
        if (!slot || slot.section_ids.length === 0) continue;

        const section = this.outline.sections.find(
          (s) => s.id === slot.section_ids[0]
        );
        if (!section) continue;

        const sectionOffset = section.start_time - this.offset;
        if (sectionOffset < 0) continue;

        const synth = new SimpleSynth(this.ctx, this.masterGain!);
        synth.scheduleRecording(recording, this.playStartedAt + sectionOffset);
        this.slotSynths.push(synth);
      }
    }
  }

  // --- Transport clock ---

  private startClock(): void {
    const tick = () => {
      if (!this.playing) return;

      const position = this.getCurrentTime();

      // Check if we've reached the end (guard: duration must be > 0)
      if (this.duration > 0 && position >= this.duration) {
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

      // Detect section changes for Conductor integration
      if (this.performanceOutline && this.onSectionChange) {
        const currentSectionIndex = findPerformanceSectionIndex(
          this.performanceOutline,
          position
        );
        if (currentSectionIndex !== this.lastSectionIndex) {
          const prevIndex = this.lastSectionIndex;
          this.lastSectionIndex = currentSectionIndex;
          if (prevIndex >= 0) {
            this.onSectionChange(prevIndex, currentSectionIndex);
          }
        }
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

  // --- Vocoder ---

  async enableVocoder(): Promise<boolean> {
    if (!this.ctx || !this.masterGain || this.vocoderEnabled) return false;

    const voice = getVoiceInput();
    const micOk = await voice.init(this.ctx);
    if (!micOk) return false;

    this.vocoder = new Vocoder(this.ctx);

    const sourceNode = voice.getSourceNode();
    if (sourceNode) {
      this.vocoder.connectModulator(sourceNode);
    }

    this.vocoder.getOutput().connect(this.masterGain);

    this.carrierSynth = new CarrierSynth(this.vocoder);
    this.carrierSynth.start();

    this.vocoderEnabled = true;
    return true;
  }

  disableVocoder(): void {
    if (!this.vocoderEnabled) return;

    this.carrierSynth?.dispose();
    this.carrierSynth = null;

    const voice = getVoiceInput();
    const sourceNode = voice.getSourceNode();
    if (sourceNode && this.vocoder) {
      this.vocoder.disconnectModulator(sourceNode);
    }

    this.vocoder?.dispose();
    this.vocoder = null;

    voice.dispose();

    this.vocoderEnabled = false;
  }

  setVocoderGain(value: number): void {
    this.vocoder?.setGain(Math.max(0, Math.min(1, value)));
  }

  isVocoderEnabled(): boolean {
    return this.vocoderEnabled;
  }

  // --- Cleanup ---

  dispose(): void {
    this.stop();
    this.disableVocoder();
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
