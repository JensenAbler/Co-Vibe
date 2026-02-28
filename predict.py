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
import sys
import tempfile
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from cog import BasePredictor, Input, Path as CogPath

# Add the analysis package to the path
sys.path.insert(0, str(Path(__file__).parent / "analysis"))

from covibe_analysis.pipeline import run_pipeline  # noqa: E402

# Stem order convention — result.ts relies on this exact order
STEM_ORDER = ["vocals", "drums", "bass", "other"]


class Predictor(BasePredictor):
    def setup(self):
        """Pre-load Demucs model for warm predictions."""
        import demucs.api

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

        # Use mkdtemp so the directory persists after predict() returns;
        # Cog reads the output files *after* each yield.
        upload_dir = Path(tempfile.mkdtemp())

        job = {
            "id": uuid4().hex[:12],
            "file_path": str(audio_path),
            "upload_dir": str(upload_dir),
            "status": "queued",
            "progress": 0.0,
        }

        asyncio.run(run_pipeline(job, separator=self._separator))

        if job["status"] == "failed":
            raise RuntimeError(f"Pipeline failed: {job.get('error', 'unknown')}")

        outline = job["outline"]

        # Clear local stem paths from the outline — the frontend will
        # receive proper CDN URLs from the result API endpoint.
        outline.stems.vocals = ""
        outline.stems.drums = ""
        outline.stems.bass = ""
        outline.stems.other = ""

        output_path = upload_dir / "outline.json"
        output_path.write_text(outline.model_dump_json(indent=2))

        # Yield outline first
        yield CogPath(str(output_path))

        # Yield stems in the defined order
        for stem_name in STEM_ORDER:
            stem_path = upload_dir / f"{stem_name}.wav"
            if stem_path.exists():
                yield CogPath(str(stem_path))
            else:
                # Should not happen, but skip gracefully
                print(f"Warning: stem {stem_name}.wav not found in {upload_dir}")
