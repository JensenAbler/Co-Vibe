"""
Essentia key detection wrapper.

Detects the musical key and mode from separated harmonic stems
(bass + other) using HPCP analysis.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import essentia.standard as es

logger = logging.getLogger(__name__)


def detect_key(stem_paths: dict[str, str]) -> dict:
    """
    Run Essentia KeyExtractor on harmonic stems.

    Uses EDMA profile as default, Krumhansl as fallback,
    and returns the profile with higher confidence.

    Args:
        stem_paths: Dict mapping stem names to file paths.

    Returns:
        {"tonic": "A", "mode": "minor", "confidence": 0.85}
    """
    # Mix bass + other stems for harmonic content
    harmonic_audio = _load_harmonic_mix(stem_paths)

    # Run both profiles and pick the one with higher confidence
    edma_key, edma_scale, edma_strength = es.KeyExtractor(profileType="edma")(harmonic_audio)
    krum_key, krum_scale, krum_strength = es.KeyExtractor(profileType="krumhansl")(harmonic_audio)

    logger.info(
        "Key detection — EDMA: %s %s (%.3f), Krumhansl: %s %s (%.3f)",
        edma_key, edma_scale, edma_strength,
        krum_key, krum_scale, krum_strength,
    )

    if edma_strength >= krum_strength:
        return {"tonic": edma_key, "mode": edma_scale, "confidence": float(edma_strength)}
    else:
        return {"tonic": krum_key, "mode": krum_scale, "confidence": float(krum_strength)}


def _load_harmonic_mix(stem_paths: dict[str, str]) -> np.ndarray:
    """Load and mix the bass and other stems for harmonic analysis."""
    loader_args = {"sampleRate": 44100}

    parts = []
    for stem_name in ("bass", "other"):
        path = stem_paths.get(stem_name)
        if path and Path(path).exists():
            audio = es.MonoLoader(filename=path, **loader_args)()
            parts.append(audio)

    if not parts:
        raise ValueError("No harmonic stems (bass, other) found for key detection")

    # Mix stems together: pad shorter to match longest, then average
    max_len = max(len(p) for p in parts)
    mixed = np.zeros(max_len, dtype=np.float32)
    for p in parts:
        mixed[:len(p)] += p
    mixed /= len(parts)

    return mixed
