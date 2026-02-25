"""
Analysis pipeline orchestrator.

Runs Demucs first, then Essentia + madmom + All-In-One in parallel,
then assembles the Song Outline.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from covibe_analysis.schemas import SongOutline
from covibe_analysis.separation import separate_stems
from covibe_analysis.key_detection import detect_key
from covibe_analysis.beat_tracking import track_beats
from covibe_analysis.structure import segment_structure
from covibe_analysis.outline import assemble_outline


async def run_pipeline(job: dict) -> None:
    """
    Execute the full analysis pipeline for a job.

    Updates job status/progress in-place as each step completes.
    """
    try:
        file_path = Path(job["file_path"])
        upload_dir = Path(job["upload_dir"])

        # Step 1: Source separation (must complete before downstream steps)
        job["status"] = "separating"
        job["progress"] = 0.1
        stem_paths = await asyncio.to_thread(separate_stems, file_path, upload_dir)
        job["stem_paths"] = stem_paths

        # Steps 2-4: Run in parallel after separation
        job["status"] = "detecting_key"
        job["progress"] = 0.4

        key_task = asyncio.to_thread(detect_key, stem_paths)
        beat_task = asyncio.to_thread(track_beats, file_path, stem_paths)
        structure_task = asyncio.to_thread(segment_structure, stem_paths)

        key_result, beat_result, structure_result = await asyncio.gather(
            key_task, beat_task, structure_task
        )

        # Step 5: Assemble Song Outline
        job["status"] = "assembling"
        job["progress"] = 0.9

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

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
