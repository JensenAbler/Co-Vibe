"""
Demucs source separation wrapper.

Splits a mixed audio track into isolated stems:
vocals, drums, bass, other.
"""

from __future__ import annotations

import logging
from pathlib import Path

import demucs.api

logger = logging.getLogger(__name__)


def separate_stems(
    audio_path: Path,
    output_dir: Path,
    separator: demucs.api.Separator | None = None,
) -> dict[str, str]:
    """
    Run Demucs v4 Hybrid Transformer on the input audio file.

    Args:
        audio_path: Path to the source audio file.
        output_dir: Directory to write separated stem WAV files.
        separator: Pre-loaded Demucs Separator (avoids reload on each call).

    Returns:
        Dict mapping stem names to file paths:
        {"vocals": "...", "drums": "...", "bass": "...", "other": "..."}
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    if separator is None:
        logger.info("Loading Demucs htdemucs model")
        separator = demucs.api.Separator(model="htdemucs")

    logger.info("Separating stems from %s", audio_path)
    _, separated = separator.separate_audio_file(str(audio_path))

    stem_paths: dict[str, str] = {}
    for stem_name, audio_tensor in separated.items():
        stem_file = output_dir / f"{stem_name}.wav"
        demucs.api.save_audio(audio_tensor, str(stem_file), samplerate=separator.samplerate)
        stem_paths[stem_name] = str(stem_file)
        logger.info("Wrote stem %s to %s", stem_name, stem_file)

    return stem_paths
