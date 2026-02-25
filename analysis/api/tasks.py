"""
Background task management for the analysis pipeline.

Jobs are stored in-memory for now. Each job tracks its current status,
progress, and results.
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from covibe_analysis.pipeline import run_pipeline

logger = logging.getLogger(__name__)

# In-memory job store. Replace with a proper store (Redis, DB) for production.
jobs: dict[str, dict] = {}


async def start_analysis_job(file: UploadFile) -> dict:
    """
    Save the uploaded file and launch the analysis pipeline.
    """
    job_id = uuid4().hex[:12]

    # Save uploaded file to a temp directory
    upload_dir = Path(tempfile.mkdtemp(prefix="covibe_"))
    file_path = upload_dir / (file.filename or "upload.wav")
    content = await file.read()
    file_path.write_bytes(content)

    job = {
        "id": job_id,
        "status": "queued",
        "progress": 0.0,
        "file_path": str(file_path),
        "upload_dir": str(upload_dir),
        "stem_paths": {},
        "outline": None,
        "error": None,
    }
    jobs[job_id] = job

    logger.info("Starting analysis pipeline for job %s (%s)", job_id, file.filename)
    asyncio.create_task(run_pipeline(job))

    return job
