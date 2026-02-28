"""
Integration tests for the Phase 1 analysis pipeline.

These tests mock the heavy ML libraries (demucs, essentia, madmom, allin1)
to verify that the pipeline orchestration, data flow, and outline assembly
work correctly without requiring actual model weights.
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from covibe_analysis.schemas import SongOutline, SectionLabel, SlotTrack


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def audio_dir(tmp_path: Path) -> Path:
    """Create a temp directory with a dummy audio file."""
    audio_file = tmp_path / "test_song.wav"
    audio_file.write_bytes(b"\x00" * 1024)  # dummy bytes
    return tmp_path


@pytest.fixture
def audio_file(audio_dir: Path) -> Path:
    return audio_dir / "test_song.wav"


@pytest.fixture
def fake_stem_paths(audio_dir: Path) -> dict[str, str]:
    """Create dummy stem files and return their paths."""
    stems = {}
    for name in ("vocals", "drums", "bass", "other"):
        p = audio_dir / f"{name}.wav"
        p.write_bytes(b"\x00" * 512)
        stems[name] = str(p)
    return stems


# ---------------------------------------------------------------------------
# separation.py tests
# ---------------------------------------------------------------------------

class TestSeparation:
    @patch("covibe_analysis.separation.demucs.api")
    def test_separate_stems_returns_four_stems(self, mock_api, audio_file, tmp_path):
        from covibe_analysis.separation import separate_stems

        output_dir = tmp_path / "stems"

        # Mock the Separator
        mock_separator = MagicMock()
        mock_separator.samplerate = 44100
        mock_api.Separator.return_value = mock_separator

        # Mock separate_audio_file to return fake tensors
        import torch
        fake_separated = {
            "vocals": torch.zeros(2, 44100),
            "drums": torch.zeros(2, 44100),
            "bass": torch.zeros(2, 44100),
            "other": torch.zeros(2, 44100),
        }
        mock_separator.separate_audio_file.return_value = (None, fake_separated)

        result = separate_stems(audio_file, output_dir)

        assert set(result.keys()) == {"vocals", "drums", "bass", "other"}
        mock_api.Separator.assert_called_once_with(model="htdemucs")
        mock_separator.separate_audio_file.assert_called_once()
        # save_audio should be called 4 times (once per stem)
        assert mock_api.save_audio.call_count == 4


# ---------------------------------------------------------------------------
# key_detection.py tests
# ---------------------------------------------------------------------------

class TestKeyDetection:
    @patch("covibe_analysis.key_detection.es")
    def test_detect_key_picks_higher_confidence(self, mock_es, fake_stem_paths):
        from covibe_analysis.key_detection import detect_key

        # Mock MonoLoader
        mock_es.MonoLoader.return_value = MagicMock(return_value=np.zeros(44100, dtype=np.float32))

        # Mock KeyExtractor: EDMA returns lower confidence, Krumhansl higher
        edma_extractor = MagicMock(return_value=("C", "major", 0.6))
        krum_extractor = MagicMock(return_value=("A", "minor", 0.85))

        def make_extractor(profileType="bgate"):
            if profileType == "edma":
                return edma_extractor
            return krum_extractor

        mock_es.KeyExtractor.side_effect = make_extractor

        result = detect_key(fake_stem_paths)

        assert result["tonic"] == "A"
        assert result["mode"] == "minor"
        assert result["confidence"] == 0.85

    @patch("covibe_analysis.key_detection.es")
    def test_detect_key_picks_edma_when_higher(self, mock_es, fake_stem_paths):
        from covibe_analysis.key_detection import detect_key

        mock_es.MonoLoader.return_value = MagicMock(return_value=np.zeros(44100, dtype=np.float32))

        edma_extractor = MagicMock(return_value=("D", "major", 0.9))
        krum_extractor = MagicMock(return_value=("B", "minor", 0.7))

        def make_extractor(profileType="bgate"):
            if profileType == "edma":
                return edma_extractor
            return krum_extractor

        mock_es.KeyExtractor.side_effect = make_extractor

        result = detect_key(fake_stem_paths)

        assert result["tonic"] == "D"
        assert result["mode"] == "major"
        assert result["confidence"] == 0.9


# ---------------------------------------------------------------------------
# beat_tracking.py tests
# ---------------------------------------------------------------------------

class TestBeatTracking:
    @patch("covibe_analysis.beat_tracking.DeepChromaChordRecognitionProcessor")
    @patch("covibe_analysis.beat_tracking.DeepChromaProcessor")
    @patch("covibe_analysis.beat_tracking.DBNDownBeatTrackingProcessor")
    @patch("covibe_analysis.beat_tracking.RNNDownBeatProcessor")
    @patch("covibe_analysis.beat_tracking.DBNBeatTrackingProcessor")
    @patch("covibe_analysis.beat_tracking.RNNBeatProcessor")
    def test_track_beats_returns_expected_structure(
        self, mock_rnn_beat, mock_dbn_beat, mock_rnn_db, mock_dbn_db,
        mock_chroma, mock_chord, audio_file, fake_stem_paths,
    ):
        from covibe_analysis.beat_tracking import track_beats

        # Beat processor returns beat times
        beats = np.array([0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0])
        mock_rnn_beat.return_value = MagicMock(return_value=np.zeros(100))
        mock_dbn_beat.return_value = MagicMock(return_value=beats)

        # Downbeat processor
        downbeat_result = np.array([
            [0.5, 1], [1.0, 2], [1.5, 3], [2.0, 4],
            [2.5, 1], [3.0, 2], [3.5, 3], [4.0, 4],
        ])
        mock_rnn_db.return_value = MagicMock(return_value=np.zeros((100, 2)))
        mock_dbn_db.return_value = MagicMock(return_value=downbeat_result)

        # Chord processor
        chord_result = [
            (0.0, 2.0, "A:min"),
            (2.0, 4.0, "F:maj"),
        ]
        mock_chroma.return_value = MagicMock(return_value=np.zeros((100, 12)))
        mock_chord.return_value = MagicMock(return_value=chord_result)

        result = track_beats(audio_file, fake_stem_paths)

        assert "beats" in result
        assert "downbeats" in result
        assert "bpm" in result
        assert "bpm_confidence" in result
        assert "chords" in result

        assert len(result["beats"]) == 8
        assert len(result["downbeats"]) == 2  # positions where beat_pos == 1
        assert result["bpm"] == pytest.approx(120.0, rel=0.1)
        assert len(result["chords"]) == 2
        assert result["chords"][0]["chord"] == "Am"
        assert result["chords"][1]["chord"] == "F"


# ---------------------------------------------------------------------------
# beat_tracking chord normalization
# ---------------------------------------------------------------------------

class TestChordNormalization:
    def test_major_chord(self):
        from covibe_analysis.beat_tracking import _normalize_chord_label
        assert _normalize_chord_label("C:maj") == "C"

    def test_minor_chord(self):
        from covibe_analysis.beat_tracking import _normalize_chord_label
        assert _normalize_chord_label("A:min") == "Am"

    def test_no_chord(self):
        from covibe_analysis.beat_tracking import _normalize_chord_label
        assert _normalize_chord_label("N") == "N"

    def test_other_quality(self):
        from covibe_analysis.beat_tracking import _normalize_chord_label
        assert _normalize_chord_label("G:7") == "G7"


# ---------------------------------------------------------------------------
# structure.py tests
# ---------------------------------------------------------------------------

class TestStructure:
    @patch("covibe_analysis.structure.allin1")
    def test_segment_structure_returns_sections(self, mock_allin1, fake_stem_paths, audio_dir):
        from covibe_analysis.structure import segment_structure

        # Mock allin1.analyze result
        mock_result = SimpleNamespace(
            segments=[
                SimpleNamespace(start=0.0, end=15.2, label="intro"),
                SimpleNamespace(start=15.2, end=45.8, label="verse"),
                SimpleNamespace(start=45.8, end=68.3, label="chorus"),
                SimpleNamespace(start=68.3, end=80.0, label="outro"),
            ],
        )
        mock_allin1.analyze.return_value = mock_result

        result = segment_structure(fake_stem_paths)

        assert "sections" in result
        assert len(result["sections"]) == 4
        assert result["sections"][0]["label"] == "intro"
        assert result["sections"][1]["label"] == "verse"
        assert result["sections"][2]["label"] == "chorus"
        assert result["sections"][3]["label"] == "outro"
        assert result["sections"][0]["start_time"] == 0.0
        assert result["sections"][0]["end_time"] == 15.2

    @patch("covibe_analysis.structure.allin1")
    def test_segment_structure_maps_inst_to_instrumental(self, mock_allin1, fake_stem_paths, audio_dir):
        from covibe_analysis.structure import segment_structure

        mock_result = SimpleNamespace(
            segments=[
                SimpleNamespace(start=0.0, end=30.0, label="inst"),
            ],
        )
        mock_allin1.analyze.return_value = mock_result

        result = segment_structure(fake_stem_paths)

        assert result["sections"][0]["label"] == "instrumental"

    @patch("covibe_analysis.structure.allin1")
    def test_segment_structure_skips_unknown_labels(self, mock_allin1, fake_stem_paths, audio_dir):
        from covibe_analysis.structure import segment_structure

        mock_result = SimpleNamespace(
            segments=[
                SimpleNamespace(start=0.0, end=1.0, label="start"),
                SimpleNamespace(start=1.0, end=30.0, label="verse"),
                SimpleNamespace(start=30.0, end=31.0, label="end"),
            ],
        )
        mock_allin1.analyze.return_value = mock_result

        result = segment_structure(fake_stem_paths)

        assert len(result["sections"]) == 1
        assert result["sections"][0]["label"] == "verse"


# ---------------------------------------------------------------------------
# outline.py tests
# ---------------------------------------------------------------------------

class TestOutlineAssembly:
    def test_assemble_outline_produces_valid_song_outline(self, audio_file):
        from covibe_analysis.outline import assemble_outline

        stem_paths = {
            "vocals": "/tmp/vocals.wav",
            "drums": "/tmp/drums.wav",
            "bass": "/tmp/bass.wav",
            "other": "/tmp/other.wav",
        }

        key_result = {"tonic": "A", "mode": "minor", "confidence": 0.85}
        beat_result = {
            "beats": [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
            "downbeats": [0.5, 2.5],
            "bpm": 120.0,
            "bpm_confidence": 0.95,
            "chords": [
                {"chord": "Am", "start_time": 0.0, "end_time": 2.0, "start_beat": 0, "end_beat": 3},
                {"chord": "F", "start_time": 2.0, "end_time": 4.0, "start_beat": 3, "end_beat": 6},
            ],
        }
        structure_result = {
            "sections": [
                {"label": "intro", "start_time": 0.0, "end_time": 15.0},
                {"label": "verse", "start_time": 15.0, "end_time": 45.0},
                {"label": "chorus", "start_time": 45.0, "end_time": 70.0},
                {"label": "outro", "start_time": 70.0, "end_time": 80.0},
            ],
        }

        outline = assemble_outline(
            source_path=audio_file,
            stem_paths=stem_paths,
            key_result=key_result,
            beat_result=beat_result,
            structure_result=structure_result,
        )

        assert isinstance(outline, SongOutline)
        assert outline.key.tonic == "A"
        assert outline.key.mode == "minor"
        assert outline.tempo.bpm == 120.0
        assert len(outline.sections) == 4
        assert outline.sections[0].label == SectionLabel.intro
        assert outline.sections[1].label == SectionLabel.verse

        # Should have slots: melody (verse+chorus), chords (all), bass (all),
        # pad (intro+outro), drums (all)
        track_names = {s.track_name for s in outline.slots}
        assert SlotTrack.melody in track_names
        assert SlotTrack.chords in track_names
        assert SlotTrack.bass in track_names
        assert SlotTrack.pad in track_names
        assert SlotTrack.drums in track_names

        # Melody slot should cover verse and chorus (not intro/outro)
        melody_slot = next(s for s in outline.slots if s.track_name == SlotTrack.melody)
        verse_id = outline.sections[1].id
        chorus_id = outline.sections[2].id
        assert verse_id in melody_slot.section_ids
        assert chorus_id in melody_slot.section_ids


# ---------------------------------------------------------------------------
# pipeline.py WAV conversion
# ---------------------------------------------------------------------------

class TestEnsureWav:
    def test_wav_file_passes_through(self, audio_file):
        from covibe_analysis.pipeline import _ensure_wav

        result = _ensure_wav(audio_file)
        assert result == audio_file

    @patch("covibe_analysis.pipeline.sf")
    def test_mp3_file_gets_converted(self, mock_sf, tmp_path):
        from covibe_analysis.pipeline import _ensure_wav

        mp3_file = tmp_path / "song.mp3"
        mp3_file.write_bytes(b"\x00" * 512)

        mock_sf.read.return_value = (np.zeros((44100, 2)), 44100)

        result = _ensure_wav(mp3_file)

        assert result.suffix == ".wav"
        assert result.stem == "song"
        mock_sf.read.assert_called_once_with(str(mp3_file))
        mock_sf.write.assert_called_once_with(
            str(tmp_path / "song.wav"),
            mock_sf.read.return_value[0],
            44100,
            subtype="PCM_16",
        )

    def test_flac_is_in_conversion_set(self):
        from covibe_analysis.pipeline import _NEEDS_CONVERSION

        for ext in (".mp3", ".m4a", ".aac", ".ogg", ".wma", ".flac", ".opus"):
            assert ext in _NEEDS_CONVERSION

    def test_wav_is_not_in_conversion_set(self):
        from covibe_analysis.pipeline import _NEEDS_CONVERSION

        assert ".wav" not in _NEEDS_CONVERSION


# ---------------------------------------------------------------------------
# pipeline.py integration test
# ---------------------------------------------------------------------------

class TestPipeline:
    @patch("covibe_analysis.pipeline.segment_structure")
    @patch("covibe_analysis.pipeline.track_beats")
    @patch("covibe_analysis.pipeline.detect_key")
    @patch("covibe_analysis.pipeline.separate_stems")
    def test_run_pipeline_updates_job_to_complete(
        self, mock_separate, mock_key, mock_beats, mock_structure, audio_file, audio_dir,
    ):
        from covibe_analysis.pipeline import run_pipeline

        # Setup mocks
        stem_paths = {
            "vocals": str(audio_dir / "vocals.wav"),
            "drums": str(audio_dir / "drums.wav"),
            "bass": str(audio_dir / "bass.wav"),
            "other": str(audio_dir / "other.wav"),
        }
        for p in stem_paths.values():
            Path(p).write_bytes(b"\x00" * 256)

        mock_separate.return_value = stem_paths
        mock_key.return_value = {"tonic": "C", "mode": "major", "confidence": 0.9}
        mock_beats.return_value = {
            "beats": [0.5, 1.0, 1.5, 2.0],
            "downbeats": [0.5],
            "bpm": 128.0,
            "bpm_confidence": 0.92,
            "chords": [
                {"chord": "C", "start_time": 0.0, "end_time": 4.0, "start_beat": 0, "end_beat": 3},
            ],
        }
        mock_structure.return_value = {
            "sections": [
                {"label": "verse", "start_time": 0.0, "end_time": 30.0},
                {"label": "chorus", "start_time": 30.0, "end_time": 60.0},
            ],
        }

        job = {
            "id": "test123",
            "status": "queued",
            "progress": 0.0,
            "file_path": str(audio_file),
            "upload_dir": str(audio_dir),
            "stem_paths": {},
            "outline": None,
            "error": None,
        }

        asyncio.run(run_pipeline(job))

        assert job["status"] == "complete"
        assert job["progress"] == 1.0
        assert job["outline"] is not None
        assert isinstance(job["outline"], SongOutline)
        assert job["outline"].key.tonic == "C"
        assert job["error"] is None

    @patch("covibe_analysis.pipeline.separate_stems")
    def test_run_pipeline_handles_failure(self, mock_separate, audio_file, audio_dir):
        from covibe_analysis.pipeline import run_pipeline

        mock_separate.side_effect = RuntimeError("GPU out of memory")

        job = {
            "id": "fail123",
            "status": "queued",
            "progress": 0.0,
            "file_path": str(audio_file),
            "upload_dir": str(audio_dir),
            "stem_paths": {},
            "outline": None,
            "error": None,
        }

        asyncio.run(run_pipeline(job))

        assert job["status"] == "failed"
        assert "GPU out of memory" in job["error"]
