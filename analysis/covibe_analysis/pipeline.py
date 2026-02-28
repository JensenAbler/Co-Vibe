"""
Analysis pipeline orchestrator.

Runs Demucs first, then Essentia + madmom + All-In-One in parallel,
then assembles the Song Outline.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import soundfile as sf

from covibe_analysis.schemas import SongOutline
from covibe_analysis.separation import separate_stems
from covibe_analysis.key_detection import detect_key
from covibe_analysis.beat_tracking import track_beats
from covibe_analysis.structure import segment_structure
from covibe_analysis.outline import assemble_outline

logger = logging.getLogger(__name__)

# Formats that need conversion to WAV before analysis.
# MP3 decoders introduce variable offsets (~20-40ms) that cause
# timing misalignment between analysis modules.
_NEEDS_CONVERSION = {".mp3", ".m4a", ".aac", ".ogg", ".wma", ".flac", ".opus"}


def _ensure_wav(file_path: Path) -> Path:
    """
    Convert non-WAV audio to WAV so all downstream analyzers
    decode from the same canonical PCM representation.
    """
    if file_path.suffix.lower() not in _NEEDS_CONVERSION:
        return file_path

    wav_path = file_path.with_suffix(".wav")
    logger.info("Converting %s → WAV", file_path.suffix)
    data, samplerate = sf.read(str(file_path))
    sf.write(str(wav_path), data, samplerate, subtype="PCM_16")
    return wav_path


async def run_pipeline(job: dict, separator=None) -> None:
    """
    Execute the full analysis pipeline for a job.

    Args:
        job: Mutable dict with job state (id, file_path, upload_dir, status, progress).
        separator: Pre-loaded Demucs Separator instance (optional).

    Updates job status/progress in-place as each step completes.
    """
    try:
        file_path = Path(job["file_path"])
        upload_dir = Path(job["upload_dir"])

        # Step 0: Normalize to WAV to avoid MP3 decoder offset issues
        file_path = await asyncio.to_thread(_ensure_wav, file_path)
        job["file_path"] = str(file_path)

        # Step 1: Source separation (~60s, must complete before downstream steps)
        job["status"] = "separating"
        job["progress"] = 0.1
        logger.info("[%s] Starting source separation", job["id"])
        stem_paths = await asyncio.to_thread(separate_stems, file_path, upload_dir, separator)
        job["stem_paths"] = stem_paths
        job["progress"] = 0.4
        logger.info("[%s] Separation complete", job["id"])

        # Steps 2-4: Run in parallel after separation (~15s total)
        job["status"] = "analyzing"
        logger.info("[%s] Starting parallel analysis (key + beats + structure)", job["id"])

        key_task = asyncio.to_thread(detect_key, stem_paths)
        beat_task = asyncio.to_thread(track_beats, file_path, stem_paths)
        structure_task = asyncio.to_thread(segment_structure, stem_paths)

        key_result, beat_result, structure_result = await asyncio.gather(
            key_task, beat_task, structure_task
        )
        job["progress"] = 0.9
        logger.info("[%s] Parallel analysis complete", job["id"])

        # Step 5: Assemble Song Outline
        job["status"] = "assembling"
        logger.info("[%s] Assembling Song Outline", job["id"])

        outline = assemble_outline(
            source_path=file_path,
            stem_paths=stem_paths,
            key_result=key_result,
            beat_result=beat_result,
            structure_result=structure_result,
        )

        job["outline"] = outline
        job["status"] = "complete"
        job["progress"] = 1.0
        logger.info("[%s] Pipeline complete — %s %s, %.0f BPM",
                     job["id"], outline.key.tonic, outline.key.mode, outline.tempo.bpm)

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        logger.exception("[%s] Pipeline failed", job["id"])
