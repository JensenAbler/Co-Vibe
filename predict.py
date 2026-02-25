"""
Cog prediction entrypoint for Co Vibe analysis pipeline.

Wraps the analysis pipeline for deployment on Replicate.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

from cog import BasePredictor, Input, Path as CogPath

# Add the analysis package to the path
sys.path.insert(0, str(Path(__file__).parent / "analysis"))

from covibe_analysis.pipeline import run_pipeline  # noqa: E402


class Predictor(BasePredictor):
    def setup(self):
        """Pre-load Demucs model for warm predictions."""
        import demucs.api

        self._separator = demucs.api.Separator(model="htdemucs")

    def predict(self, audio: CogPath = Input(description="Audio file to analyze")) -> CogPath:
        """Run the full analysis pipeline and return the SongOutline JSON."""
        audio_path = Path(str(audio))

        with tempfile.TemporaryDirectory() as tmp_dir:
            upload_dir = Path(tmp_dir)

            job = {
                "id": uuid4().hex[:12],
                "file_path": str(audio_path),
                "upload_dir": str(upload_dir),
                "status": "queued",
                "progress": 0.0,
            }

            asyncio.run(run_pipeline(job))

            if job["status"] == "failed":
                raise RuntimeError(f"Pipeline failed: {job.get('error', 'unknown')}")

            outline = job["outline"]
            output_path = upload_dir / "outline.json"
            output_path.write_text(outline.model_dump_json(indent=2))

            return CogPath(str(output_path))
