# Co Vibe — Design Document v0.3

**Date:** February 25, 2026
**Author:** Jensen + Claude
**Status:** Technical Draft — Deployment Architecture & Session Format
**Predecessor:** design-doc-v0.2.md

---

## 1. Purpose of This Document

v0.2 described how to build Co Vibe — which frameworks, what pipeline, where the hard problems are. This document describes how to **deploy** it — the split architecture between frontend and GPU analysis, how audio files move through the system, what a session looks like on disk, and how the pieces connect in production.

This document also addresses several open questions from v0.2 §10.

## 2. Deployment Architecture

Co Vibe has two fundamentally different runtime requirements:

| Component | Compute | Latency | Duration |
|---|---|---|---|
| Frontend (React/Web Audio) | Browser | Real-time | Entire session |
| Analysis pipeline (Demucs + Essentia + madmom + All-In-One) | GPU | Not real-time | ~90s one-shot |

These cannot live on the same host. The frontend is static files + lightweight API proxying. The analysis pipeline needs a GPU for an acceptable wait time. The solution is a split deployment:

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                           │
│                                                                 │
│  React App (Vite)  +  Web Audio API  +  Web MIDI API            │
│       │                                                         │
│       │  1. Upload audio file                                   │
│       │  2. Poll for analysis result                            │
│       │  3. Receive SongOutline JSON                            │
│       │  4. Enter performance phase (all client-side)           │
└───────┼─────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────┐       ┌─────────────────────────────┐
│       VERCEL               │       │       REPLICATE              │
│                           │       │                             │
│  Static frontend (dist/)  │       │  Cog container (GPU)        │
│  + API routes:            │       │                             │
│    POST /api/analyze      │──────▶│  - Receives audio URL       │
│    GET  /api/status/[id]  │       │  - Runs full pipeline       │
│    POST /api/webhook      │◀──────│  - Returns SongOutline JSON │
│                           │       │  - Returns stem URLs        │
│  Env: REPLICATE_API_TOKEN │       │                             │
│       REPLICATE_MODEL_VER │       │  GPU: L40S ($0.000975/s)    │
└───────────────────────────┘       │  ~90s per track ≈ $0.09     │
                                    └─────────────────────────────┘
```

### 2.1 Why This Split

- **Vercel** serves the React app with zero config, global CDN, and instant deploys. Serverless functions handle the thin API layer (token proxying, webhook receiver). No GPU needed.
- **Replicate** provides pay-per-second GPU containers via the Cog framework. The analysis pipeline runs as a single prediction: audio in, SongOutline JSON + stem URLs out. No idle GPU costs — you only pay for the ~90 seconds of actual analysis.
- The **browser** handles the entire performance phase (Web Audio API, MIDI input, voice input). Once the SongOutline arrives, no server is needed until the user wants to save/share.

### 2.2 Why Not Other Options

| Option | Why not |
|---|---|
| Vercel serverless for analysis | 250 MB bundle limit; no GPU; 4.5 MB request body limit |
| Railway/Fly GPU container | Pays for idle time between uploads; more infra to manage |
| Self-hosted GPU box | Doesn't scale; single point of failure; requires sysadmin |
| Client-side analysis (WASM) | Demucs/PyTorch don't run in the browser; would take 30+ minutes on CPU |

## 3. Request Flow: Upload to Outline

### Step 1: Upload Audio

The frontend uploads the audio file directly to Replicate's Files API. This bypasses Vercel's 4.5 MB request body limit (audio files are typically 5-30 MB).

```
Browser ──POST /v1/files──▶ Replicate Files API
                              │
                              ▼
                           Returns file URL
                           (expires in 24h, max 100 MB)
```

The upload request is authenticated with the Replicate token. Since this token must stay server-side, the frontend first calls a Vercel function to get a short-lived upload URL, or the Vercel function proxies the upload.

### Step 2: Start Analysis

```
Browser ──POST /api/analyze──▶ Vercel Function
           { audioUrl }            │
                                   │  POST /v1/predictions
                                   │  { input: { audio: audioUrl },
                                   │    webhook: /api/webhook }
                                   ▼
                              Replicate API
                                   │
                                   ▼
                              Returns prediction ID
                                   │
Browser ◀── { predictionId } ◀─────┘
```

### Step 3: GPU Analysis (~90 seconds)

Replicate spins up the Cog container (cold start: ~60s first time; warm: instant) and runs the full pipeline:

1. Download audio from file URL
2. Convert to WAV if needed
3. Demucs source separation (~60s)
4. Parallel: Essentia key + madmom beats + All-In-One structure (~15s)
5. Assemble SongOutline
6. Upload SongOutline JSON + stem WAV files to Replicate storage
7. POST webhook to Vercel

### Step 4: Result Delivery

Two paths, both implemented:

**Webhook (primary):** Replicate POSTs the completed prediction to `/api/webhook`. The Vercel function extracts the output URLs and stores the result in Vercel KV or similar.

**Polling (fallback):** The frontend polls `GET /api/status/{predictionId}` every 2-3 seconds. The Vercel function checks Replicate's prediction status and returns it.

```
Browser ──GET /api/status/xyz──▶ Vercel Function
                                      │
                                      │  GET /v1/predictions/xyz
                                      ▼
                                 Replicate API
                                      │
                                      ▼
Browser ◀── { status, progress } ◀────┘

(when status === "succeeded")
Browser ◀── { outline: SongOutline, stems: {...} }
```

### Step 5: Stem Delivery

The separated stem WAV files are needed for the performance phase (playback of the original track's components). Replicate's output includes URLs to the uploaded stems. These URLs are temporary (Replicate storage), so the frontend should fetch them immediately and store them in IndexedDB for the session.

## 4. Cog Model Specification

The analysis pipeline is packaged as a single Cog model.

### cog.yaml

```yaml
build:
  python_version: "3.11"
  gpu: true
  system_packages:
    - "ffmpeg"
    - "libsndfile1"
  python_requirements: requirements.txt
  run:
    - "pip install numpy<2.0"

predict: "predict.py:Predictor"
```

### predict.py

The Cog predictor wraps the existing `covibe_analysis` pipeline:

```python
from cog import BasePredictor, Path, Input
from covibe_analysis.pipeline import _ensure_wav
from covibe_analysis.separation import separate_stems
from covibe_analysis.key_detection import detect_key
from covibe_analysis.beat_tracking import track_beats
from covibe_analysis.structure import segment_structure
from covibe_analysis.outline import assemble_outline
from pathlib import Path as FilePath
import json

class Predictor(BasePredictor):
    def setup(self):
        # Pre-load models to avoid cold-start penalty on first prediction
        import demucs.api
        self.separator = demucs.api.Separator(model="htdemucs")

    def predict(self, audio: Path = Input(description="Audio file")) -> Path:
        audio_path = _ensure_wav(FilePath(str(audio)))
        output_dir = FilePath("/tmp/stems")

        stem_paths = separate_stems(audio_path, output_dir)
        key_result = detect_key(stem_paths)
        beat_result = track_beats(audio_path, stem_paths)
        structure_result = segment_structure(stem_paths)

        outline = assemble_outline(
            source_path=audio_path,
            stem_paths=stem_paths,
            key_result=key_result,
            beat_result=beat_result,
            structure_result=structure_result,
        )

        result_path = FilePath("/tmp/result.json")
        result_path.write_text(outline.model_dump_json())
        return Path(str(result_path))
```

**Note:** This is a simplified sketch. The actual implementation will also need to return stem files — either as multiple outputs, or bundled into a ZIP, or uploaded to external storage with URLs included in the JSON output.

### GPU Selection

| GPU | Cost per analysis | Cold start | Recommendation |
|---|---|---|---|
| T4 (16 GB) | ~$0.02 | ~60s | Too slow for Demucs; analysis may take 5+ minutes |
| L40S (48 GB) | ~$0.09 | ~60s | Good balance of speed and cost for MVP |
| A100 (80 GB) | ~$0.13 | ~60s | Overkill unless batch-processing many tracks |

**Recommendation:** L40S for MVP. At $0.09 per track, a user analyzing 10 tracks per month costs $0.90.

## 5. Vercel Project Structure

```
co-vibe/
├── api/                          # Vercel serverless functions
│   ├── analyze.ts                # POST: upload to Replicate, start prediction
│   ├── status/[id].ts            # GET: poll prediction status
│   ├── webhook.ts                # POST: receive Replicate completion webhook
│   └── upload.ts                 # POST: proxy file upload to Replicate Files API
├── frontend/
│   ├── src/                      # React app (existing)
│   ├── vite.config.ts
│   └── package.json
├── vercel.json
└── package.json
```

### vercel.json

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/((?!api/.*).*)", "destination": "/index.html" }
  ],
  "functions": {
    "api/analyze.ts": { "maxDuration": 30 },
    "api/status/[id].ts": { "maxDuration": 15 },
    "api/webhook.ts": { "maxDuration": 30 },
    "api/upload.ts": { "maxDuration": 60 }
  }
}
```

### Environment Variables

| Variable | Description |
|---|---|
| `REPLICATE_API_TOKEN` | Server-side only. Replicate API key (`r8_...`). |
| `REPLICATE_MODEL_VERSION` | Server-side only. SHA256 of the deployed Cog model version. |

## 6. Session File Format

A Co Vibe session captures everything needed for carbon-copy replay and interactive remix.

### Structure

```
session-{id}.covibe               (ZIP archive)
├── manifest.json                 # Session metadata + version
├── outline.json                  # SongOutline (from analysis)
├── stems/                        # Source-separated audio
│   ├── vocals.wav
│   ├── drums.wav
│   ├── bass.wav
│   └── other.wav
├── recordings/                   # User-recorded slot content
│   ├── {slot-id}.wav             # Audio recordings
│   └── {slot-id}.midi.json       # MIDI recordings (note events)
├── agent-fills/                  # Agent-generated slot content
│   ├── {slot-id}.wav
│   └── {slot-id}.midi.json
└── timeline.json                 # Ordered event log for replay
```

### manifest.json

```json
{
  "version": "1.0",
  "id": "session-abc123",
  "created_at": "2026-02-25T15:30:00Z",
  "updated_at": "2026-02-25T15:45:00Z",
  "source_track": {
    "filename": "my-song.wav",
    "duration": 210.5,
    "sha256": "a1b2c3..."
  },
  "covibe_version": "0.1.0"
}
```

### timeline.json

The timeline is an ordered array of events that occurred during the performance. It enables both carbon-copy replay and understanding what the user/agent did.

```json
{
  "events": [
    {
      "type": "slot_prompted",
      "timestamp": 0.0,
      "slot_id": "abc123",
      "track": "melody",
      "section": "verse"
    },
    {
      "type": "recording_started",
      "timestamp": 2.5,
      "slot_id": "abc123",
      "modality": "midi"
    },
    {
      "type": "recording_completed",
      "timestamp": 18.2,
      "slot_id": "abc123",
      "file": "recordings/abc123.midi.json"
    },
    {
      "type": "transport",
      "timestamp": 20.0,
      "action": "play",
      "position": 0.0
    },
    {
      "type": "agent_fill",
      "timestamp": 25.0,
      "slot_id": "def456",
      "track": "bass",
      "file": "agent-fills/def456.midi.json"
    },
    {
      "type": "mix_change",
      "timestamp": 30.0,
      "track": "drums",
      "action": "mute"
    }
  ]
}
```

**Event types:**

| Type | Description |
|---|---|
| `slot_prompted` | Agent prompted user for a slot |
| `recording_started` | User began recording into a slot |
| `recording_completed` | Recording finished, file saved |
| `agent_fill` | Agent autonomously filled a slot |
| `transport` | Play/pause/seek events |
| `mix_change` | Mute/solo/volume changes |
| `slot_cleared` | User cleared a filled slot |

### Storage

Sessions are stored in the browser's IndexedDB via the `idb` library (already in the frontend dependencies). The `.covibe` ZIP is also downloadable as a file for sharing, backup, and future import.

### MIDI Recording Format

MIDI recordings are stored as JSON arrays of note events rather than binary `.mid` files. This keeps them human-readable and easy to manipulate in JavaScript.

```json
{
  "slot_id": "abc123",
  "modality": "midi",
  "events": [
    { "type": "noteOn",  "note": 60, "velocity": 100, "time": 0.0 },
    { "type": "noteOff", "note": 60, "velocity": 0,   "time": 0.5 },
    { "type": "noteOn",  "note": 64, "velocity": 90,  "time": 0.5 },
    { "type": "noteOff", "note": 64, "velocity": 0,   "time": 1.0 }
  ],
  "duration": 4.0
}
```

## 7. Analysis Pipeline: Local vs. Cloud

The analysis pipeline can run in two modes. The codebase supports both.

### Cloud Mode (Replicate) — Default for deployed app

- User uploads audio → Replicate GPU processes it → returns SongOutline + stems
- No GPU required on user's machine
- ~$0.09 per track
- ~90 seconds on L40S (plus cold start on first use)

### Local Mode — For development and power users

- User runs `uvicorn api.server:app` locally with the ML dependencies installed
- Frontend proxies to `localhost:8000` (already configured in Vite's dev server)
- Requires a CUDA-capable GPU for acceptable speed
- Free (no API costs)

The frontend's `analysis-client.ts` already abstracts the API calls. Switching between modes is a matter of which base URL the client targets — the response shape (SongOutline JSON) is identical.

## 8. Cost Estimate

### Per-user costs (cloud mode)

| Action | Cost |
|---|---|
| Upload + analyze 1 track | ~$0.09 (L40S GPU for ~90s) |
| Replicate file storage | Free (files expire after 24h) |
| Vercel hosting (Hobby) | Free |
| Vercel serverless invocations | Free tier: 100K/month |

### Monthly cost scenarios

| Usage | Replicate | Vercel | Total |
|---|---|---|---|
| 10 tracks/month (one user testing) | $0.90 | Free | $0.90 |
| 100 tracks/month (small beta) | $9.00 | Free | $9.00 |
| 1,000 tracks/month (public launch) | $90.00 | Pro ($20) | $110.00 |

Cold starts add ~60 seconds to the first prediction after a period of inactivity. For a better experience at scale, a Replicate Deployment with `min_instances: 1` eliminates cold starts but costs ~$3.51/hour for L40S idle time ($2,527/month).

## 9. Answers to v0.2 Open Questions

> **What's the deployment model?**

Vercel (frontend) + Replicate (analysis GPU). See §2-5 above.

> **Should the analysis pipeline run locally or in the cloud?**

Both. Cloud by default (Replicate), local for development. See §7.

> **What's the session file format specification?**

`.covibe` ZIP archive with JSON metadata + WAV/MIDI content. See §6.

> **What synth sounds does the agent use to fill slots autonomously?**

Deferred to v0.4. Candidates: Web Audio API OscillatorNode with basic waveforms for MVP, sample-based instruments for production quality.

> **How does the "from scratch" mode generate a song outline without a source track?**

Deferred to v0.4. Likely LLM-generated outlines from a genre/mood prompt, constrained to the SongOutline schema.

> **How does echo cancellation work well enough for voice input in a browser?**

Deferred to v0.4. Initial approach: headphones-first recommendation, `echoCancellation: true` in getUserMedia, gain staging.

> **How do multiple Co Vibers collaborate on the same session?**

Deferred. Multiplayer is a post-MVP feature. The session format (§6) is designed to be portable and shareable as a first step.

## 10. Open Questions for v0.4

- How should the Cog model return stem files alongside the SongOutline? Multiple outputs, ZIP bundle, or external storage URLs in the JSON?
- Should Replicate webhook results be stored in Vercel KV, Upstash Redis, or Supabase?
- What's the authentication model? Do users need accounts, or is it anonymous-first?
- How do we handle Replicate cold starts gracefully in the UI? Pre-warming? Loading animation with realistic time estimate?
- What happens when the user's session outlasts the 24-hour Replicate file expiry? Should stems be persisted to longer-term storage (R2, S3)?
- Agent slot-filling: what sound generation approach? Web Audio oscillators, sample playback, or a lightweight synthesis model?

## 11. Implementation Phases (Updated)

| Phase | Status | Description |
|---|---|---|
| **Phase 0** | Complete | Project scaffolding — Python backend + TypeScript frontend |
| **Phase 1** | Complete | Analysis pipeline integration — Demucs, Essentia, madmom, All-In-One |
| **Phase 2** | Next | Cog packaging + Vercel API routes + upload-to-outline flow working end-to-end |
| **Phase 3** | — | Performance engine — Web Audio playback, MIDI input, slot recording |
| **Phase 4** | — | DAW interface — track visualization, mute/solo, transport controls |
| **Phase 5** | — | Agent state machine — prompt sequencing, autonomous slot filling |
| **Phase 6** | — | Session persistence — save/load/export `.covibe` files |

---

*This document makes the v0.2 architecture deployable. The split is clean: Vercel for the frontend, Replicate for the GPU. The session format captures everything needed for replay and remix. v0.4 will specify the agent's autonomous behaviors, sound design, and the from-scratch mode.*
