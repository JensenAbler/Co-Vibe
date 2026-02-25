# Co Vibe — Design Document v0.2

**Date:** February 25, 2026
**Author:** Jensen + Claude
**Status:** Technical Draft — Framework Selection & Architecture
**Predecessor:** design-doc-v0.1.md

---

## 1. Purpose of This Document

v0.1 described *what* Co Vibe is. This document describes *how* to build it — which open-source frameworks power each capability, how they connect, what the technical architecture looks like, and where the hard problems are.

## 2. Architecture Overview

Co Vibe has two distinct phases with different technical requirements:

```
┌─────────────────────────────────────────────────────┐
│  PHASE 1: ANALYSIS (pre-performance, not real-time) │
│                                                     │
│  Source Track → Demucs → Separated Stems            │
│                    ↓                                 │
│  Stems → Key Detection (Essentia)                   │
│  Stems → Chord Progression (madmom / ChordMini)     │
│  Stems → Structure Segmentation (All-In-One)        │
│                    ↓                                 │
│  Song Outline (key, chords, sections, slots)        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  PHASE 2: PERFORMANCE (real-time, low-latency)      │
│                                                     │
│  Song Outline → Agent (structural navigation)       │
│  Agent → Prompts user for slot input                │
│  User Input (voice, MIDI, percussion, semantic)     │
│       ↓                                             │
│  Audio Engine (mixing, effects, vocoder, playback)  │
│  Plugin Audio → Pitch Constraint → Mix              │
│       ↓                                             │
│  Stereo Output                                      │
└─────────────────────────────────────────────────────┘
```

The analysis phase can be computationally expensive — it runs once per source track and doesn't need to be real-time. The performance phase must be low-latency and uninterruptible.

## 3. Analysis Engine: Framework Selection

### 3.1 Source Separation — Demucs (Meta AI)

**What it does:** Splits a mixed audio track into isolated stems (vocals, drums, bass, other). The v4 Hybrid Transformer model also supports 6-source separation (adding piano and guitar).

**Why it matters for Co Vibe:** Every downstream analysis task benefits from clean stems. Chord detection on a separated harmonic stem is far more reliable than on a full mix. Structure segmentation can use per-stem features. The decomposition step in Co Vibe's core concept maps directly to what Demucs does.

**Repository:** https://github.com/facebookresearch/demucs
**License:** MIT
**Performance:** ~4x real-time on GPU (a 4-minute track processes in ~1 minute)
**Quality:** 9.2 dB SDR on standard benchmarks (v4 Hybrid Transformer)

**Integration notes:**
- Python library, pip-installable
- Runs on CPU or GPU (CUDA). GPU strongly recommended for acceptable analysis times
- Output: separated WAV files per stem
- These stems feed into all three downstream analyzers

### 3.2 Key Detection — Essentia

**What it does:** Computes key and scale (e.g., "A minor", "C major") from audio using Harmonic Pitch Class Profile (HPCP) analysis with configurable key profile types.

**Why it matters for Co Vibe:** Key is the foundation of the harmonic constraint system. Every other harmonic decision (chord voicings, vocoder carrier, plugin pitch constraining) depends on knowing the key.

**Repository:** https://github.com/MTG/essentia
**License:** AGPLv3 (commercial license available from MTG)
**Key profiles available:**
- **Krumhansl** — cognitive experiment-derived, good for pop
- **EDMA** — designed for electronic dance music
- **Temperley** — corpus-derived from euroclassical music
- **Diatonic** — binary profile, useful for ambient/modal music

**Accuracy context:** Even commercial key detection software (Mixed In Key) achieves ~76.5% agreement with human musicians. Two human musicians agree with each other ~75% of the time. Key detection is inherently ambiguous for some tracks (relative major/minor confusion is the most common disagreement).

**Integration notes:**
- C++ core with Python bindings (essentia Python package)
- Also has JavaScript bindings (essentia.js) — relevant if analysis ever moves client-side
- Run on the separated harmonic stem (bass + other from Demucs) for best results
- Fast — key detection on a single track takes seconds

**Recommendation:** Use Essentia with the **EDMA** profile as default (given Co Vibe's pop/EDM focus), with **Krumhansl** as fallback. Allow the agent to use both and compare confidence scores.

### 3.3 Chord Progression — madmom + ChordMini

Two tools serve complementary roles here:

#### madmom

**What it does:** Beat tracking, downbeat detection, tempo estimation, and chord recognition using RNNs and HMMs.

**Why it matters for Co Vibe:** Provides beat-aligned timing grid that chord and structure information maps onto. Its chord estimator achieves 89.6% accuracy for major/minor triads — sufficient for Co Vibe's well-trodden-structures design philosophy.

**Repository:** https://github.com/CPJKU/madmom
**License:** BSD-3-Clause
**Strengths:** Best-in-class beat tracking (confirmed by 2025 Frontiers benchmark across 500 clips, 4 genres). RNN-based with high temporal precision.
**Limitations:** Chord vocabulary limited to major/minor triads.

#### ChordMini

**What it does:** Deep learning chord recognition with 301 chord labels (12 keys × 25 chord types + no-chord), beat-synchronized visualization, and optional LLM-based tonal analysis.

**Repository:** https://github.com/ptnghia-j/ChordMiniApp
**License:** Open source (check repo for specific license)
**Strengths:** Much richer chord vocabulary (7ths, diminished, augmented, inversions). Uses Chord-CNN-LSTM and Beat-Transformer models. Optional Gemini integration for context-aware enharmonic correction.
**Limitations:** More complex dependency chain. LLM integration adds latency (acceptable since analysis is pre-performance).

**Recommendation:** Use **madmom** for beat/downbeat grid and tempo. Use **ChordMini** for chord labels mapped onto that grid. madmom provides the timing backbone; ChordMini provides harmonic detail. For MVP, madmom's major/minor triads alone may be sufficient — ChordMini extends the vocabulary when needed.

### 3.4 Structure Segmentation — All-In-One Music Structure Analyzer

**What it does:** Identifies section boundaries and labels them with functional tags: intro, verse, chorus, bridge, instrumental, solo, outro, break, start, end.

**Why it matters for Co Vibe:** This is what generates the song outline — the scaffold of designated slots that the co-performance fills in. Without reliable structure segmentation, there is no Co Vibe.

**Repository:** https://github.com/mir-aidj/all-in-one
**License:** Open source (MIT)
**Installation:** `pip install allin1`
**Model:** Trained on the Harmonix Set with 8-fold cross-validation. Takes source-separated stems as input (embeddings shaped as [stems=4, time_steps, embedding_size=24] for bass, drums, other, vocals).
**Output:** Tempo, beats, downbeats, segment boundaries with functional labels.

**Integration notes:**
- Already designed to work with source-separated stems — aligns perfectly with the Demucs output
- Available as a Replicate API (https://replicate.com/sakemin/all-in-one-music-structure-analyzer) for cloud deployment
- Also available on Hugging Face Spaces for testing
- MIREX 2025 uses the same Harmonix dataset and 7-label taxonomy (intro, verse, chorus, bridge, inst, outro, other) — this is the current academic standard

**Performance:** Processed 33 minutes of audio in 73 seconds on an RTX 4090.

**Recommendation:** All-In-One is the clear choice. It's the most mature open-source option, it's pip-installable, it takes stem-separated input (matching our Demucs output), and its label taxonomy maps directly to Co Vibe's structural vocabulary.

### 3.5 Analysis Pipeline Summary

```
Source Track (audio file)
       │
       ▼
   ┌────────┐
   │ Demucs │ → vocals, drums, bass, other (WAV stems)
   └────┬───┘
        │
        ├──► Essentia (key detection on harmonic stems)
        │         → key, scale, confidence
        │
        ├──► madmom (beat/downbeat/tempo on full mix or drum stem)
        │         → beat grid, BPM, time signature
        │
        ├──► ChordMini (chord labels on harmonic stems, aligned to beat grid)
        │         → chord progression with timing
        │
        └──► All-In-One (structure on all stems)
                  → section boundaries + labels (intro, verse, chorus...)
                           │
                           ▼
                  ┌─────────────────┐
                  │   SONG OUTLINE  │
                  │                 │
                  │  key: Am        │
                  │  bpm: 120       │
                  │  sections:      │
                  │   - intro (8 bars, Am → F) │
                  │   - verse (16 bars, Am → F → C → G) │
                  │   - chorus (8 bars, F → G → Am → C) │
                  │   - ...         │
                  │  slots:         │
                  │   - melody (verse, chorus) │
                  │   - bass (all sections)    │
                  │   - drums (all sections)   │
                  │   - chords (all sections)  │
                  │   - vocals (verse, chorus) │
                  └─────────────────┘
```

**Total analysis time estimate:** For a 3.5-minute pop track on a machine with a mid-range GPU:
- Demucs separation: ~60 seconds
- Essentia key detection: ~2 seconds
- madmom beat tracking: ~5 seconds
- ChordMini chord recognition: ~10 seconds
- All-In-One structure: ~15 seconds
- **Total: ~90 seconds** (pipeline can be partially parallelized after Demucs)

## 4. Performance Engine: Framework Selection

### 4.1 Audio Engine Decision: Web Audio API vs. JUCE

This is the most consequential technical decision in the project.

#### Web Audio API

**Pros:**
- Runs in any modern browser — zero installation, instant access
- Aligns with "everyone" target audience — lowest possible barrier to entry
- The evolving-synth-standalone reference plugin is already built on Web Audio API
- AudioWorklet provides dedicated audio thread (~3-5ms latency achievable)
- Web MIDI API available for MIDI input
- Rapid prototyping, fast iteration

**Cons:**
- Latency is higher and more variable than native (browser-dependent, OS-dependent)
- No direct hardware audio driver access (no ASIO, no CoreAudio exclusive mode)
- Performance ceiling for complex DSP — limited by JavaScript/WASM runtime
- Browser differences in audio implementation (Gecko vs. Blink vs. WebKit)
- Garbage collection can cause audio glitches in edge cases

**Achievable latency:** ~5-15ms in ideal conditions (Chrome, AudioWorklet, low buffer size). Can degrade to 20-40ms under load or on slower hardware.

#### JUCE (C++)

**Pros:**
- Industry standard for professional audio applications
- Direct hardware access — achievable latency of ~2-3ms with proper drivers
- SIMD optimizations, native performance ceiling
- Cross-platform: Windows, macOS, Linux, iOS, Android
- Massive ecosystem of audio DSP knowledge and libraries
- JUCE 7 (2025) includes significant performance improvements

**Cons:**
- Requires installation (violates "zero barrier" principle)
- C++ development is slower to iterate on than JavaScript
- Steeper learning curve for contributors
- GPL license (commercial license available from PACE)

#### Recommendation: Web Audio API for v1, JUCE for v2

Start with Web Audio API. The rationale:

1. **Co Vibe's audience is "everyone"** — not audio professionals. Browser delivery means zero friction.
2. **The evolving-synth-standalone plugin already runs on Web Audio** — immediate compatibility.
3. **The performance requirements are manageable** for Web Audio. Co Vibe is not running 47 tracks of heavy DSP. It's running a handful of tracks with the agent managing complexity.
4. **AudioWorklet provides a dedicated audio thread** that avoids main-thread jank.
5. **Iteration speed matters** at this stage — JavaScript/TypeScript ships faster than C++.

If latency or performance becomes a bottleneck (especially for serious live performance use), a JUCE native client becomes the v2 path. The analysis pipeline (Python) remains the same regardless of performance engine choice.

### 4.2 Vocoder — cwilso/Vocoder (Web Audio)

**What it does:** A multi-band vocoder implementation using the Web Audio API. Takes a modulator signal (human voice) and a carrier signal, and outputs the voice shaped by the carrier's harmonic content.

**Repository:** https://github.com/cwilso/Vocoder
**Approach:** 28-band (variable) filter bank vocoder. Supports live input. MIDI control over pitch and parameters.

**How it works in Co Vibe:** The carrier signal is generated from the agent's knowledge of the current chord. The human sings (modulator), and the vocoder harmonizes the voice against the chord progression. The agent updates the carrier frequencies as chords change. The user doesn't need to play a keyboard to drive the vocoder — the song outline drives it.

**Alternative:** The LPC-based web vocoder (https://github.com/Web-based-vocoder/web-based-vocoder.github.io) uses Linear Predictive Coding for voice transformations and real-time vocal tract visualization. More computationally expensive but potentially richer sound.

**Recommendation:** Start with cwilso/Vocoder for its simplicity and proven Web Audio integration. Evaluate LPC-based approach if timbral richness is insufficient.

### 4.3 Plugin Pitch Constraining

This is the mechanism that makes dumb plugins fit the song's harmonic context. Two approaches:

#### Approach A: Voltage-style quantization (for synthesis plugins)

If the plugin exposes pitch as a parameter (as the evolving synth does — its oscillator frequencies are set programmatically), the system can quantize pitch values to the nearest note in the current key/chord *before they reach the oscillator*. This is the modular synth "quantizer" approach: constrain the control signal, not the audio.

**How it works:** The plugin's pitch output (or frequency parameter) passes through a quantizer that snaps to the nearest note in the current scale. As chords change, the allowed note set updates. The plugin's timbre, evolution, and internal logic are untouched — only pitch is constrained.

**Implementation:** Pure math — no library needed. Map frequencies to MIDI note numbers, snap to nearest scale degree, map back. Runs in an AudioWorklet or as pre-processing on the plugin's parameter updates.

**Latency:** Essentially zero (parameter-level operation, not audio-level).

#### Approach B: Real-time audio pitch shifting (for audio-output-only plugins)

If a plugin only outputs raw audio (no exposed pitch parameter), pitch must be shifted at the audio level.

**Options:**

- **Phaze** (https://github.com/olvb/phaze) — Phase vocoder-based pitch shifter as a Web Audio Worklet. Already designed for real-time browser use.
- **Rubber Band Library** (https://github.com/breakfastquay/rubberband) — High-quality pitch shifting, but GPL licensed and heavier. Reports of >100ms latency in real-time contexts. Better suited for JUCE/native path.
- **SoundTouch** (https://github.com/nicholasgasior/nicholasgasior/soundtouch) — LGPL, lighter weight, lower latency, but poorer audio quality (time-domain processing, bad transient handling).
- **Pitch Snap** (https://github.com/extracell/pitch-snap) — Polyphonic pitch quantization VST plugin. Per-note snapping with smoothing controls. Could be studied for its algorithm even if the VST format doesn't directly apply to Web Audio.

**Recommendation:** For the evolving synth specifically, use **Approach A** (parameter-level quantization) — it already exposes Fourier harmonics and oscillator frequencies programmatically. This is the cleanest, lowest-latency path. For future plugins that only output audio, **Phaze** is the best Web Audio-native option for Approach B.

### 4.4 MIDI Input — Web MIDI API

The Web MIDI API is a browser-native standard. No library needed.

**Capabilities:**
- Enumerate connected MIDI devices
- Receive Note On/Off with velocity
- Receive CC messages (knobs, faders, mod wheel, pitch bend)
- Supports USB and Bluetooth MIDI devices

**Integration notes:**
- Already implemented in the evolving-synth-standalone (see `midi-input.ts`)
- Route note data to the currently prompted slot
- Map CC messages to system parameters (track volume, effect sends, agent controls)
- Requires HTTPS or localhost (browser security requirement)

**Browser support:** Chrome, Edge, Opera. Firefox has experimental support behind a flag. Safari does not support Web MIDI API. This is a consideration for the "everyone" audience — Safari users on macOS/iOS would lose MIDI input.

### 4.5 Voice Input

Browser microphone access via `getUserMedia()`. Route the audio stream two ways:

1. **Into the mix** — through the effects chain (reverb, delay, vocoder) and out to speakers. This is a direct audio path through Web Audio nodes.
2. **To the agent** (analytical) — for understanding melodic intent. This path doesn't need to be real-time — slight latency is fine for analysis.

**Echo cancellation:** Critical for live performance. If the system's audio output feeds back into the microphone, it creates feedback loops. Browser echo cancellation (`echoCancellation: true` in getUserMedia constraints) helps but may not be sufficient for musical contexts. This is an open engineering challenge.

## 5. Session Format

A saved Co Vibe session needs to capture:

**Song Outline:**
- Key, BPM, time signature
- Section boundaries with labels
- Chord progression with timing
- Slot definitions (which tracks, which sections)

**Performance Data:**
- Per-slot recordings (audio buffers or MIDI note sequences)
- Timing of when each slot was filled
- Agent decisions (which prompts were issued, which modality was used)
- Plugin states (attractor snapshots, parameter values at each point)
- Mute/solo/manipulation events with timestamps

**Replay Modes:**
- **Carbon-copy:** Replay all audio and events exactly as captured. Essentially a multi-track recording.
- **Interactive remix:** Load the song outline and filled slots. Re-enter the performance loop. User can re-record individual slots, adjust the mix, or let the agent re-fill slots.

**Format consideration:** A custom JSON schema for the song outline and event timeline, with audio data stored as WAV/WebM blobs. The session file is a bundle (ZIP or similar) containing both. This keeps the format inspectable and portable.

## 6. Agent Architecture (Preliminary)

The agent is the intelligence layer between the song outline and the user. It is NOT an AI model running inference during performance — it is a state machine navigating a known structure.

**During analysis:** The agent may use LLM capabilities to:
- Generate song outlines from scratch (given a genre/mood description)
- Interpret ambiguous analysis results (e.g., relative major/minor key decision)
- Assign slots to sections (deciding that the verse needs melody + bass + chords but no vocal)

**During performance:** The agent is a deterministic navigator:
- Tracks current position in the song outline
- Knows which slots are filled and which are empty
- Prompts the user for the next unfilled slot
- Manages autonomous completion if the user steps away
- Updates harmonic context (current chord) for vocoder and plugin pitch constraining

**The agent does NOT:**
- Re-analyze audio during performance
- Re-interpret or reroute user input based on what they're playing
- Make structural decisions after the song outline is set

This separation means the performance engine can be fast and predictable. The intelligence lives in the pre-performance analysis and the prompt sequencing, not in real-time audio interpretation.

## 7. Dependency Map

```
ANALYSIS PHASE (Python)
├── demucs          (MIT)         — source separation
├── essentia        (AGPLv3)      — key detection
├── madmom          (BSD-3)       — beat/tempo/chord
├── allin1          (MIT)         — structure segmentation
└── chordmini       (check repo)  — extended chord recognition

PERFORMANCE PHASE (TypeScript / Web Audio API)
├── Web Audio API   (browser-native)  — audio routing, mixing, effects
├── AudioWorklet    (browser-native)  — dedicated audio processing thread
├── Web MIDI API    (browser-native)  — MIDI device input
├── getUserMedia    (browser-native)  — microphone input
├── cwilso/Vocoder  (Apache-2.0)      — vocoder effect
└── olvb/phaze      (MIT)             — pitch shifting (for audio-only plugins)

PLUGIN REFERENCE (TypeScript / Web Audio API)
└── evolving-synth-standalone         — Fourier synth with timbral evolution
```

**License decision:** Co Vibe is open-source under AGPLv3. This is both a practical decision (Essentia's AGPL license requires it for networked applications) and a philosophical one — ideas should move freely. The entire codebase is available under AGPL. All other dependencies in the pipeline (Demucs MIT, madmom BSD-3, All-In-One MIT) are compatible with AGPL.

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Web Audio latency too high for live feel | High | AudioWorklet, small buffer sizes, benchmark early. JUCE escape hatch for v2. |
| Analysis pipeline too slow for casual use | Medium | Pre-compute and cache. Cloud analysis option (Replicate API for All-In-One already exists). |
| Vocoder feedback loop (mic picks up speakers) | High | Echo cancellation, headphone-first recommendation, gain staging. |
| Safari lacks Web MIDI API | Medium | Graceful degradation — MIDI is optional. Core experience works without it. |
| Structure segmentation misidentifies sections | Medium | Allow user to manually adjust section boundaries post-analysis. Agent can offer corrections. |
| ~~Essentia AGPL license~~ | ~~Resolved~~ | Co Vibe is AGPLv3. License alignment is a feature, not a risk. |
| Plugin pitch constraining artifacts | Low | Parameter-level quantization (Approach A) avoids audio artifacts entirely for compatible plugins. |

## 9. MVP Scope

The minimum viable Co Vibe:

1. **Analysis:** Upload a source track → Demucs separation → Essentia key → madmom beat/chord → All-In-One structure → Song outline displayed
2. **Performance:** Song outline with slots → Agent prompts for MIDI keyboard input → User plays into slots → Audio playback with basic synth sounds → Agent fills remaining slots autonomously
3. **Interface:** Alive-DAW view with tracks, mute/solo controls
4. **Session:** Auto-save, carbon-copy replay

**Not in MVP:** Vocoder, voice input, semantic input, selection-based prompts, plugin architecture, interactive remix, from-scratch mode (no source track).

The MVP tests the core hypothesis: does co-performing with an agent that understands song structure feel good?

## 10. Open Questions for v0.3

- What synth sounds does the agent use to fill slots autonomously? Sample-based? FM synthesis? A default sound library?
- How does the "from scratch" mode generate a song outline without a source track? LLM-generated? Template library?
- What's the deployment model? Self-hosted web app? Hosted service? Electron wrapper?
- How does echo cancellation work well enough for voice input in a browser?
- Should the analysis pipeline run locally or in the cloud? (Affects GPU requirements for users)
- What's the session file format specification?
- How do multiple Co Vibers collaborate on the same session? (multiplayer)

## 11. Reference Implementations & Links

**Analysis:**
- Demucs: https://github.com/facebookresearch/demucs
- Essentia: https://essentia.upf.edu/ | https://github.com/MTG/essentia
- madmom: https://github.com/CPJKU/madmom
- All-In-One: https://github.com/mir-aidj/all-in-one
- ChordMini: https://github.com/ptnghia-j/ChordMiniApp

**Performance:**
- cwilso/Vocoder: https://github.com/cwilso/Vocoder
- Phaze (pitch shifter): https://github.com/olvb/phaze
- Pitch Snap: https://github.com/extracell/pitch-snap
- Web Audio API spec: https://www.w3.org/TR/webaudio/
- Web MIDI API spec: https://www.w3.org/TR/webmidi/

**Context:**
- JUCE: https://juce.com/ | https://github.com/juce-framework/JUCE
- Rubber Band: https://breakfastquay.com/rubberband/
- MIREX 2025 Structure Analysis: https://www.music-ir.org/mirex/wiki/2025:Music_Structure_Analysis

---

*This document makes the v0.1 vision buildable. The frameworks exist. The pipeline is clear. The hard problems are identified. v0.3 will specify the session format, agent prompt logic, and default sound design.*
