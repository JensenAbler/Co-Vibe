"""
Essentia key detection wrapper.

Detects the musical key and mode from separated harmonic stems
(bass + other) using HPCP analysis.

Phase 1 will add the actual Essentia integration.
"""

from __future__ import annotations


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
    # TODO (Phase 1): Integrate Essentia
    # import essentia.standard as es
    # key_extractor = es.KeyExtractor(profileType="edma")
    raise NotImplementedError("Essentia integration pending — Phase 1")
