"""
REST API routes for the analysis pipeline.

POST /api/analyze          — Upload audio, start analysis, return job ID
GET  /api/analyze/{id}/status  — Poll for analysis progress
GET  /api/analyze/{id}/result  — Get completed Song Outline
GET  /api/analyze/{id}/stems/{name} — Download a separated stem
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

from api.tasks import jobs, start_analysis_job
from covibe_analysis.schemas import AnalysisStatus, AnalysisResult

router = APIRouter()


@router.post("/analyze", response_model=AnalysisStatus)
async def analyze(file: UploadFile = File(...)):
    """Upload an audio file and start the analysis pipeline."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    job = await start_analysis_job(file)
    return AnalysisStatus(job_id=job["id"], status="queued", progress=0.0)


@router.get("/analyze/{job_id}/status", response_model=AnalysisStatus)
async def get_status(job_id: str):
    """Poll for the current analysis pipeline progress."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return AnalysisStatus(
        job_id=job_id,
        status=job["status"],
        progress=job["progress"],
        error=job.get("error"),
    )


@router.get("/analyze/{job_id}/result", response_model=AnalysisResult)
async def get_result(job_id: str):
    """Retrieve the completed Song Outline for a finished analysis job."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] != "complete":
        raise HTTPException(status_code=409, detail=f"Job not complete (status: {job['status']})")

    return AnalysisResult(job_id=job_id, outline=job["outline"])


@router.get("/analyze/{job_id}/stems/{stem_name}")
async def get_stem(job_id: str, stem_name: str):
    """Download a separated stem WAV file."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if stem_name not in ("vocals", "drums", "bass", "other"):
        raise HTTPException(status_code=400, detail=f"Invalid stem name: {stem_name}")

    stem_path = job.get("stem_paths", {}).get(stem_name)
    if not stem_path:
        raise HTTPException(status_code=404, detail=f"Stem '{stem_name}' not available")

    return FileResponse(stem_path, media_type="audio/wav", filename=f"{stem_name}.wav")
