"""
Pydantic models for the Co Vibe Song Outline — the core data contract
between the Python analysis pipeline and the TypeScript performance frontend.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def _id() -> str:
    return uuid4().hex[:12]


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SectionLabel(str, Enum):
    intro = "intro"
    verse = "verse"
    chorus = "chorus"
    bridge = "bridge"
    instrumental = "instrumental"
    solo = "solo"
    outro = "outro"
    break_ = "break"


class SlotTrack(str, Enum):
    melody = "melody"
    bass = "bass"
    chords = "chords"
    drums = "drums"
    pad = "pad"


class SlotStatus(str, Enum):
    empty = "empty"
    user_filled = "user-filled"
    agent_filled = "agent-filled"


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------

class KeyInfo(BaseModel):
    tonic: str = Field(..., description="Note name, e.g. 'A', 'C#', 'Bb'")
    mode: Literal["major", "minor"]
    confidence: float = Field(..., ge=0.0, le=1.0)


class TempoInfo(BaseModel):
    bpm: float
    confidence: float = Field(..., ge=0.0, le=1.0)


class TimeSignature(BaseModel):
    numerator: int = Field(4, description="Beats per bar")
    denominator: int = Field(4, description="Beat unit")


class ChordEvent(BaseModel):
    chord: str = Field(..., description="Chord symbol, e.g. 'Am', 'F', 'G7'")
    start_time: float = Field(..., description="Start time in seconds")
    end_time: float = Field(..., description="End time in seconds")
    start_beat: int = Field(..., description="Beat index (0-based)")
    end_beat: int = Field(..., description="Beat index (0-based)")


class Section(BaseModel):
    id: str = Field(default_factory=_id)
    label: SectionLabel
    start_time: float = Field(..., description="Seconds")
    end_time: float = Field(..., description="Seconds")
    start_beat: int
    end_beat: int
    chords: list[ChordEvent] = Field(default_factory=list)


class Slot(BaseModel):
    id: str = Field(default_factory=_id)
    track_name: SlotTrack
    section_ids: list[str] = Field(default_factory=list)
    status: SlotStatus = SlotStatus.empty
    priority: int = Field(
        ...,
        description="Lower number = higher priority. Agent fills low-priority slots first.",
    )


class StemPaths(BaseModel):
    vocals: str = ""
    drums: str = ""
    bass: str = ""
    other: str = ""


class SourceTrackInfo(BaseModel):
    filename: str
    duration: float = Field(..., description="Duration in seconds")
    sample_rate: int = 44100


# ---------------------------------------------------------------------------
# Top-level Song Outline
# ---------------------------------------------------------------------------

class SongOutline(BaseModel):
    id: str = Field(default_factory=_id)
    source_track: SourceTrackInfo
    key: KeyInfo
    tempo: TempoInfo
    time_signature: TimeSignature = Field(default_factory=TimeSignature)
    beats: list[float] = Field(default_factory=list, description="Beat timestamps in seconds")
    downbeats: list[float] = Field(default_factory=list, description="Downbeat timestamps in seconds")
    sections: list[Section] = Field(default_factory=list)
    slots: list[Slot] = Field(default_factory=list)
    stems: StemPaths = Field(default_factory=StemPaths)


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------

class AnalysisStatus(BaseModel):
    job_id: str
    status: Literal["queued", "separating", "detecting_key", "tracking_beats", "segmenting", "assembling", "complete", "failed"]
    progress: float = Field(0.0, ge=0.0, le=1.0, description="0-1 progress estimate")
    error: str | None = None


class AnalysisResult(BaseModel):
    job_id: str
    outline: SongOutline
