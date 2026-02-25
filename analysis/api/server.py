"""
FastAPI application entry point for the Co Vibe analysis backend.

Run with:
    uvicorn api.server:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router

app = FastAPI(
    title="Co Vibe Analysis API",
    description="Analyzes audio tracks to produce Song Outlines for co-performance.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "co-vibe-analysis"}
