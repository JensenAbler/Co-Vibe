"""
All-In-One Music Structure Analyzer wrapper.

Identifies section boundaries and labels them with functional tags:
intro, verse, chorus, bridge, instrumental, solo, outro, break.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

import allin1

logger = logging.getLogger(__name__)

# Labels All-In-One may produce that we map to our SectionLabel enum.
# 'inst' -> 'instrumental', 'start'/'end' -> skipped (boundary markers)
_LABEL_MAP = {
    "intro": "intro",
    "verse": "verse",
    "chorus": "chorus",
    "bridge": "bridge",
    "inst": "instrumental",
    "instrumental": "instrumental",
    "solo": "solo",
    "outro": "outro",
    "break": "break",
}


def segment_structure(stem_paths: dict[str, str]) -> dict:
    """
    Run All-In-One structure segmentation on separated stems.

    To avoid running Demucs a second time, we symlink/copy our
    already-separated stems into the directory structure that
    allin1 expects: demix_dir/htdemucs/<track_name>/{bass,drums,other,vocals}.wav

    Args:
        stem_paths: Dict mapping stem names to file paths.

    Returns:
        {
            "sections": [
                {"label": "intro", "start_time": 0.0, "end_time": 15.2},
                {"label": "verse", "start_time": 15.2, "end_time": 45.8},
                ...
            ]
        }
    """
    # Determine paths from the first available stem
    first_stem_path = Path(next(iter(stem_paths.values())))
    upload_dir = first_stem_path.parent

    # allin1 needs an audio file path to identify the track.
    # It looks for stems in demix_dir/htdemucs/<audio_filename_stem>/.
    # We need to provide the original audio path and pre-populate the demix dir.
    #
    # Find the original audio file (non-stem file in the upload directory)
    original_audio = _find_original_audio(upload_dir, stem_paths)

    # Pre-populate the demix directory with our existing stems
    demix_dir = upload_dir / "demix"
    track_name = original_audio.stem
    stem_dest_dir = demix_dir / "htdemucs" / track_name
    stem_dest_dir.mkdir(parents=True, exist_ok=True)

    for stem_name in ("bass", "drums", "other", "vocals"):
        src = stem_paths.get(stem_name)
        if src and Path(src).exists():
            dst = stem_dest_dir / f"{stem_name}.wav"
            if not dst.exists():
                shutil.copy2(src, dst)

    logger.info("Running All-In-One structure analysis on %s", original_audio)

    result = allin1.analyze(
        paths=original_audio,
        demix_dir=str(demix_dir),
        keep_byproducts=True,
    )

    sections = []
    for segment in result.segments:
        label = _LABEL_MAP.get(segment.label)
        if label is None:
            logger.debug("Skipping segment with label '%s'", segment.label)
            continue
        sections.append({
            "label": label,
            "start_time": float(segment.start),
            "end_time": float(segment.end),
        })

    logger.info("Found %d sections", len(sections))

    return {"sections": sections}


def _find_original_audio(upload_dir: Path, stem_paths: dict[str, str]) -> Path:
    """Find the original (non-stem) audio file in the upload directory."""
    stem_files = {Path(p).name for p in stem_paths.values()}
    audio_extensions = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma"}

    for f in upload_dir.iterdir():
        if f.is_file() and f.suffix.lower() in audio_extensions and f.name not in stem_files:
            return f

    # Fallback: if we can't distinguish, use any audio file
    for f in upload_dir.iterdir():
        if f.is_file() and f.suffix.lower() in audio_extensions:
            return f

    raise FileNotFoundError(f"No original audio file found in {upload_dir}")
