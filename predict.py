"""
Cog prediction entrypoint for Co Vibe analysis pipeline.

Wraps the analysis pipeline for deployment on Replicate.

Uses Iterator[CogPath] output so that Replicate uploads each file
(outline.json + stem WAVs) to its CDN.  The prediction output is an
ordered array of URLs:
  [0] outline.json
  [1] vocals.wav
  [2] drums.wav
  [3] bass.wav
  [4] other.wav
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from cog import BasePredictor, Input, Path as CogPath

# Add the analysis package to the path
sys.path.insert(0, str(Path(__file__).parent / "analysis"))

from covibe_analysis.pipeline import run_pipeline  # noqa: E402

# Stem order convention — result.ts relies on this exact order
STEM_ORDER = ["vocals", "drums", "bass", "other"]

# Use /app/output instead of /tmp to avoid Cog's temp directory cleanup.
OUTPUT_ROOT = Path("/app/output")


class Predictor(BasePredictor):
    def setup(self):
        """Pre-load Demucs model for warm predictions."""
        import demucs.api

        OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        self._separator = demucs.api.Separator(model="htdemucs")

    def predict(
        self, audio: CogPath = Input(description="Audio file to analyze")
    ) -> Iterator[CogPath]:
        """
        Run the full analysis pipeline and yield output files.

        Yields outline.json first, then each stem WAV in STEM_ORDER.
        Cog/Replicate will upload each file and expose them as an
        ordered array of CDN URLs in prediction.output.
        """
        audio_path = Path(str(audio))
        job_id = uuid4().hex[:12]

        # Use a persistent directory under /app/output to avoid Cog's
        # /tmp cleanup that can remove tempfile.mkdtemp() directories.
        upload_dir = OUTPUT_ROOT / job_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        print(f"[predict] Job {job_id}: upload_dir = {upload_dir}")

        # Copy the original audio into upload_dir so that downstream
        # modules (structure analysis) can find it alongside the stems.
        local_audio = upload_dir / audio_path.name
        shutil.copy2(str(audio_path), str(local_audio))
        print(f"[predict] Copied input audio to {local_audio}")

        job = {
            "id": job_id,
            "file_path": str(local_audio),
            "upload_dir": str(upload_dir),
            "status": "queued",
            "progress": 0.0,
        }

        try:
            asyncio.run(run_pipeline(job, separator=self._separator))
        except Exception as e:
            print(f"[predict] asyncio.run raised: {e}")
            raise RuntimeError(f"Pipeline raised: {e}") from e

        print(f"[predict] Pipeline status={job['status']}, progress={job['progress']}")

        if job["status"] == "failed":
            raise RuntimeError(f"Pipeline failed: {job.get('error', 'unknown')}")

        if "outline" not in job or job["outline"] is None:
            raise RuntimeError("Pipeline completed but no outline was generated")

        outline = job["outline"]

        # Clear local stem paths from the outline — the frontend will
        # receive proper CDN URLs from the result API endpoint.
        outline.stems.vocals = ""
        outline.stems.drums = ""
        outline.stems.bass = ""
        outline.stems.other = ""

        # Verify upload_dir still exists before writing
        if not upload_dir.exists():
            print(f"[predict] WARNING: upload_dir vanished, recreating {upload_dir}")
            upload_dir.mkdir(parents=True, exist_ok=True)

        output_path = upload_dir / "outline.json"
        output_path.write_text(outline.model_dump_json(indent=2))
        print(f"[predict] Wrote outline.json ({output_path.stat().st_size} bytes)")

        # Yield outline first
        yield CogPath(str(output_path))

        # Yield stems in the defined order
        for stem_name in STEM_ORDER:
            stem_path = upload_dir / f"{stem_name}.wav"
            if stem_path.exists():
                print(f"[predict] Yielding {stem_name}.wav ({stem_path.stat().st_size} bytes)")
                yield CogPath(str(stem_path))
            else:
                print(f"[predict] WARNING: stem {stem_name}.wav not found in {upload_dir}")

        # Clean up the output directory after all files have been yielded
        # (Cog has already uploaded them at this point)
        try:
            shutil.rmtree(upload_dir)
        except Exception:
            pass
