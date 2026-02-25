# Co Vibe — Design Document v0.1

**Date:** February 25, 2026
**Author:** Jensen + Claude
**Status:** Draft — Exploratory

---

## 1. What This Is

A live musical co-performance system where a human and an AI agent collaborate in real-time to build, shape, and perform a complete song. The system understands song structure deeply enough to guide the process, while the human provides the raw creative material — a hummed melody, a tapped rhythm, a spoken intention, a choice between offered directions.

The result sounds like a live looping performance. The experience feels like jamming with a musician who already knows the song you haven't written yet.

## 2. Core Concept: Structural Harmony

The system's primary intelligence is **structural**. It understands how songs are built — not at the frontier of experimental composition, but along the well-trodden paths of pop, EDM, and other widely-understood forms. Given a Katy Perry track, it knows exactly what's happening. It identifies key, chord progressions, repeating patterns, section boundaries (verse, chorus, bridge, drop, build), and the overarching arc of energy and tension.

This structural understanding serves two functions:

**Decomposition.** Feed the system a source track and it extracts a *song outline* — a scaffold of structural relationships stripped of the specific sonic content. The outline captures the architecture: how many sections, what harmonic movement, where the energy peaks, how the rhythm evolves.

**Scaffolding.** The outline becomes a template with designated slots — melody here, bass line there, chord voicing in this section, rhythmic pattern in that one. The structure is fully determined before performance begins. The co-performance is about filling in those slots, not deciding what they are. The agent prompts the human for each slot in turn. No musical knowledge is required from the human. The system translates structural needs into intuitive creative prompts.

## 3. The Performance Loop

A session follows this cycle:

```
Source Analysis (or blank-canvas scaffolding)
        ↓
  Song Outline Generated
        ↓
  ┌─────────────────────────────────┐
  │  Agent prompts for input        │
  │         ↓                       │
  │  Human provides creative input  │
  │         ↓                       │
  │  Agent integrates into structure│
  │         ↓                       │
  │  Song evolves audibly           │
  │         ↓                       │
  │  (repeat)                       │
  └─────────────────────────────────┘
        ↓
  Song completes structurally
```

### 3.1 Starting a Session

Two entry points:

- **From a source track.** The user provides a reference. The system decomposes it into a song outline — structural DNA without the specific content. The co-performance builds a new song on that skeleton.
- **From scratch.** The user describes an intention (genre, mood, energy, tempo — however they want to express it). The agent generates an appropriate structural outline and the co-performance begins from there.

### 3.2 Input Modalities

The system prompts the user for a "new kind of input" at each structural juncture. The prompt type is chosen contextually — based on what the song needs next:

- **Voice.** The human voice enters the mix directly as a sonic element — not transcribed, not converted to MIDI, but *present*. The system offers a vocoder mode that harmonizes the voice against the current chord progression in real-time, as well as a raw mode where the voice sits in the mix with standard effects processing (reverb, delay, etc.). The agent also listens analytically to vocal input to understand melodic intent for guiding other tracks, but interpretation and audio presence are separate concerns — your voice is always yours in the mix.
- **Embodied/percussive.** Tap a rhythm. Clap. Make percussive sounds. The system interprets rhythmic input and integrates it into the groove.
- **Semantic/verbal.** "Make it darker here." "This should feel like sunrise." "More tension." The system interprets intent from language and applies it structurally.
- **Selection-based.** The system offers 2–4 directions. The user picks. A creative Choose Your Own Adventure at the juncture points.
- **MIDI input.** Play a keyboard, pad controller, or any MIDI device directly into the system. Notes are routed to the track the agent has designated for the current prompt — if the agent is asking for a melody, your keyboard feeds the melody track. You hear it in context immediately. The agent does not re-interpret or reroute your input during performance; the structural slot is already determined. MIDI CC messages (knobs, faders, mod wheel) map to system parameters for real-time expressive control.
- **Direct manipulation.** At any time, the user can see the tracks the agent is helping populate and intervene directly — mute, solo, beat-repeat, modify a melody, adjust a progression.

The system chooses which modality to offer based on the current slot in the song outline and what the user seems comfortable with. The structural decisions — what track needs filling, what role it plays, where it sits in the arrangement — are already made. The prompt is about *how* the human wants to fill a known slot, not about *what* the slot is.

### 3.3 The Agent Never Drops the Ball

**This is a non-negotiable design commitment.** If the human steps away — loses focus, gets a phone call, walks out of the room — the performance doesn't stop awkwardly. The agent manages the remaining structure and brings the track to a complete, structurally standard conclusion.

The song always finishes. The agent is a reliable co-performer.

This also means the system has a concept of *structural completeness*. It knows when a song is approaching resolution and can guide it there, whether the human is actively co-creating or has handed off control.

## 4. Agency Spectrum

The human controls a continuous spectrum of agency:

```
Full human control ◄──────────────────► Full agent autonomy
   (every note is yours)              (the agent performs alone)
```

At any point, the user can:

- Take over a specific track entirely
- Let the agent handle everything while they listen
- Intervene on one element while the agent manages the rest
- Push the agent's suggestions in a different direction
- Ask the agent to redo something

The default starting position is **guided co-creation**: the agent provides structure and prompts, the human provides raw creative material. But this can slide in either direction at any moment, fluidly, without mode-switching.

## 5. What the Audience Hears

The output sounds like a **live looping performance** — layers building, elements entering and evolving, a song taking shape in real time. The structural intelligence underneath means it doesn't meander or lose coherence. It has the improvisational energy of a live set with the structural integrity of a composed track.

The primary output is the **live performance itself**. This is an instrument for real-time sonic experience, not primarily a production tool for making releasable recordings (though capturing a session as audio is a natural extension).

## 6. What This Is Not

- **Not a DAW replacement for producers.** No 47 tracks of automation lanes. The complexity is hidden behind structural intelligence, not exposed through UI surface area.
- **Not a prompt-to-song generator.** You don't type "make me a pop song" and wait. You co-perform. You're in it.
- **Not limited to musicians.** No musical knowledge required. If you can sing, tap, speak, or choose, you can perform.
- **Not pushing structural boundaries.** This system excels at well-understood song forms. It's a tool for playing among familiar structures in a new way, not for inventing new structures.

## 7. Technical Requirements (Preliminary)

### 7.1 Analysis Engine
- Key detection (high reliability)
- Chord progression identification (high reliability for standard progressions)
- Pattern recognition for non-harmonic repeating elements
- Section boundary detection (verse/chorus/bridge/drop/build/outro)
- Energy arc mapping
- Tempo and time signature detection

### 7.2 Real-Time Performance
- Low-latency audio processing (specific targets TBD per form factor)
- Continuous audio output — no gaps, no glitches, no awkward silence
- Smooth transitions between human-directed and agent-directed passages

### 7.3 Agent Intelligence
- Structural awareness: knows where we are in the song, what comes next
- Input interpretation: listens to vocal input for melodic/harmonic intent, translates tapping into rhythm, words into musical direction
- Voice integration: routes human voice directly into the mix with optional vocoder harmonization driven by the agent's chord-awareness
- Autonomous completion: can finish any song from any point in its structure
- Contextual prompting: chooses the right input modality for each moment
- Taste: makes musically reasonable default choices when the human doesn't specify

### 7.4 Form Factor
- TBD. Start with software. Hardware vision develops as the interaction model solidifies.
- Must work without specialized hardware — phone/tablet/laptop as minimum viable platform.
- Should pair well with MIDI controllers and other existing hardware when available.
- MIDI input support: keyboards, pad controllers, and any standard MIDI device over USB or Bluetooth. MIDI CC mapping for continuous control of system parameters.

## 8. Minimum Viable Analysis Engine

The v1 analysis engine requires three capabilities:

- **Key detection.** Identify the key of the source track with high reliability.
- **Chord progression identification.** Extract at least the primary chord progression. High reliability for standard progressions in pop/EDM forms.
- **Structure outline.** Identify section boundaries and label them: intro, verse, bridge, chorus, ending. This defines the song outline that the co-performance fills in.

Everything else — energy arc mapping, non-harmonic pattern recognition, tempo nuance — is v2+. These three capabilities are sufficient to generate a usable song outline with designated slots.

## 9. Visual Interface

The interface looks like a DAW — but alive. Tracks are visible, labeled, and laid out in a familiar timeline/mixer arrangement. The key difference: the tracks are not static containers waiting for input. They are actively being populated by the agent, visibly evolving in real-time.

The user can intervene at any time: mute a track, solo it, modify its contents, beat-repeat a section. The tracks are simultaneously the agent's workspace and the user's control surface. It looks like watching a DAW session being built in front of you, with your hands on the faders.

This is not the 47-track-deep complexity of Logic or Ableton. The number of tracks is determined by the song outline — typically a handful (drums, bass, chords, melody, vocals, maybe one or two more). Enough to see the structure. Not enough to overwhelm.

## 10. Session Persistence

Sessions are saved automatically as they are created. Every session produces two things:

- **A carbon-copy replay.** The exact performance, reproducible. Play it back and hear exactly what happened.
- **An interactive remix.** Return to any saved session and re-enter the co-performance. The song outline and any filled slots are preserved. The user can re-record specific tracks, let the agent re-fill slots differently, or take the arrangement in a new direction.

Sessions are not ephemeral. They are artifacts — both as finished performances and as starting points for new ones.

## 11. Plugin Architecture

Plugins are optional generative sound sources that can be added to a performance. They are **structurally unaware** — a plugin knows nothing about key, chord, section, or song structure. It simply produces sound according to its own internal logic.

The system enforces harmonic fit by pitch-constraining the plugin's output to match the current key and chord context. A plugin like the evolving synth continues evolving its timbre freely — the system just ensures that whatever pitch content it produces lands in the right harmonic territory. The timbre is the plugin's. The pitch is the system's.

**Plugin contract (minimum):**

- Plugin provides: audio output (stereo)
- System provides: pitch constraint (key + current chord), mapped onto the plugin's output
- User controls: on/off, any plugin-native parameters (e.g., attractor selection, evolution speed)

Plugins do not receive structural context. They do not know what section the song is in or what comes next. They are dumb sound sources that the system tunes.

**Reference implementation:** evolving-synth-standalone — a Fourier-based synthesizer with multi-timescale timbral evolution and an attractor system. When used as a plugin, its evolving timbres are preserved while the system constrains its pitch output to the song's harmonic structure.

## 12. Open Questions for v0.2

- How does the system handle genre-mixing or genre ambiguity in source tracks?
- How do we handle vocal input in noisy environments (live performance contexts)?
- How do seed templates / song outlines get shared between users?
- What's the latency budget per form factor?
- What's the AI model architecture? On-device inference vs. cloud? Hybrid?
- What file format represents a saved session? What's portable vs. platform-locked?
- Can song outlines (without filled slots) be shared independently as reusable templates?

## 14. Name

**Co Vibe.** You're not producing. You're not coding. You're co-vibing — building a song in real-time with an agent that knows the structure so you don't have to. The name says what it is: a collaborative vibe.

---

*This document is a living sketch. It captures the shape of an idea, not a specification. v0.2 will sharpen what v0.1 outlines.*
