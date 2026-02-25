"""
Demucs source separation wrapper.

Splits a mixed audio track into isolated stems:
vocals, drums, bass, other.

Phase 1 will add the actual Demucs integration.
"""

from __future__ import annotations

from pathlib import Path


def separate_stems(audio_path: Path, output_dir: Path) -> dict[str, str]:
    """
    Run Demucs v4 Hybrid Transformer on the input audio file.

    Args:
        audio_path: Path to the source audio file.
        output_dir: Directory to write separated stem WAV files.

    Returns:
        Dict mapping stem names to file paths:
        {"vocals": "...", "drums": "...", "bass": "...", "other": "..."}
    """
    # TODO (Phase 1): Integrate Demucs
    # from demucs.pretrained import get_model
    # from demucs.apply import apply_model
    raise NotImplementedError("Demucs integration pending — Phase 1")
