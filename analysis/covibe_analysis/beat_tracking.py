"""
madmom beat/tempo/chord tracking wrapper.

Provides beat grid, downbeats, tempo, and chord progression
using RNN-based processors.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from madmom.features.beats import RNNBeatProcessor, DBNBeatTrackingProcessor
from madmom.features.downbeats import RNNDownBeatProcessor, DBNDownBeatTrackingProcessor
from madmom.audio.chroma import DeepChromaProcessor
from madmom.features.chords import DeepChromaChordRecognitionProcessor

logger = logging.getLogger(__name__)


def track_beats(audio_path: Path, stem_paths: dict[str, str]) -> dict:
    """
    Run madmom beat tracking, downbeat detection, tempo estimation,
    and chord recognition.

    Args:
        audio_path: Path to the original mixed audio file.
        stem_paths: Dict mapping stem names to file paths.

    Returns:
        {
            "beats": [0.5, 1.0, 1.5, ...],
            "downbeats": [0.5, 2.5, ...],
            "bpm": 120.0,
            "bpm_confidence": 0.95,
            "chords": [
                {"chord": "Am", "start_time": 0.0, "end_time": 2.0,
                 "start_beat": 0, "end_beat": 4},
                ...
            ]
        }
    """
    audio_str = str(audio_path)

    # --- Beat tracking ---
    logger.info("Running RNN beat processor on %s", audio_path)
    beat_activations = RNNBeatProcessor()(audio_str)
    beats = DBNBeatTrackingProcessor(fps=100)(beat_activations)
    beats = beats.tolist()

    # --- BPM from beat intervals ---
    if len(beats) >= 2:
        intervals = np.diff(beats)
        bpm = float(60.0 / np.median(intervals))
        # Confidence based on consistency of beat intervals
        bpm_confidence = float(1.0 - min(np.std(intervals) / np.mean(intervals), 1.0))
    else:
        bpm = 120.0
        bpm_confidence = 0.0

    logger.info("Detected BPM: %.1f (confidence: %.3f)", bpm, bpm_confidence)

    # --- Downbeat tracking ---
    logger.info("Running downbeat processor")
    downbeat_activations = RNNDownBeatProcessor()(audio_str)
    downbeat_result = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)(downbeat_activations)
    # downbeat_result is 2D: [timestamp, beat_position]
    # Extract timestamps where beat_position == 1 (downbeats)
    downbeats = [float(row[0]) for row in downbeat_result if int(row[1]) == 1]

    logger.info("Found %d beats, %d downbeats", len(beats), len(downbeats))

    # --- Chord recognition ---
    logger.info("Running chord recognition")
    chroma = DeepChromaProcessor()(audio_str)
    chord_result = DeepChromaChordRecognitionProcessor()(chroma)

    chords = []
    for start_time, end_time, chord_label in chord_result:
        start_time = float(start_time)
        end_time = float(end_time)
        chord_symbol = _normalize_chord_label(chord_label)

        chords.append({
            "chord": chord_symbol,
            "start_time": start_time,
            "end_time": end_time,
            "start_beat": _find_nearest_beat(beats, start_time),
            "end_beat": _find_nearest_beat(beats, end_time),
        })

    logger.info("Found %d chord segments", len(chords))

    return {
        "beats": beats,
        "downbeats": downbeats,
        "bpm": bpm,
        "bpm_confidence": bpm_confidence,
        "chords": chords,
    }


def _normalize_chord_label(label: str) -> str:
    """
    Convert madmom chord notation to standard chord symbols.

    madmom uses 'N' for no-chord and 'X:maj'/'X:min' format.
    We want 'N' -> 'N', 'C:maj' -> 'C', 'A:min' -> 'Am'.
    """
    if label in ("N", "X"):
        return "N"

    parts = label.split(":")
    root = parts[0]
    quality = parts[1] if len(parts) > 1 else "maj"

    if quality == "maj":
        return root
    elif quality == "min":
        return f"{root}m"
    else:
        return f"{root}{quality}"


def _find_nearest_beat(beats: list[float], time: float) -> int:
    """Find the index of the beat nearest to the given time."""
    if not beats:
        return 0
    min_dist = float("inf")
    nearest = 0
    for i, beat_time in enumerate(beats):
        dist = abs(beat_time - time)
        if dist < min_dist:
            min_dist = dist
            nearest = i
    return nearest
