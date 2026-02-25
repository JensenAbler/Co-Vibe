"""Tests for Pydantic schema validation."""

from covibe_analysis.schemas import (
    SongOutline,
    SourceTrackInfo,
    KeyInfo,
    TempoInfo,
    Section,
    SectionLabel,
    ChordEvent,
    Slot,
    SlotTrack,
    SlotStatus,
    StemPaths,
)


def test_song_outline_roundtrip():
    """A SongOutline can be serialized to JSON and deserialized back."""
    outline = SongOutline(
        source_track=SourceTrackInfo(filename="test.wav", duration=210.5),
        key=KeyInfo(tonic="A", mode="minor", confidence=0.85),
        tempo=TempoInfo(bpm=120.0, confidence=0.95),
        beats=[0.5, 1.0, 1.5, 2.0],
        downbeats=[0.5, 2.5],
        sections=[
            Section(
                label=SectionLabel.verse,
                start_time=0.0,
                end_time=30.0,
                start_beat=0,
                end_beat=60,
                chords=[
                    ChordEvent(
                        chord="Am",
                        start_time=0.0,
                        end_time=15.0,
                        start_beat=0,
                        end_beat=30,
                    ),
                ],
            ),
        ],
        slots=[
            Slot(
                track_name=SlotTrack.melody,
                section_ids=["test"],
                status=SlotStatus.empty,
                priority=1,
            ),
        ],
        stems=StemPaths(
            vocals="/tmp/vocals.wav",
            drums="/tmp/drums.wav",
            bass="/tmp/bass.wav",
            other="/tmp/other.wav",
        ),
    )

    json_str = outline.model_dump_json()
    restored = SongOutline.model_validate_json(json_str)

    assert restored.key.tonic == "A"
    assert restored.key.mode == "minor"
    assert restored.tempo.bpm == 120.0
    assert len(restored.sections) == 1
    assert restored.sections[0].label == SectionLabel.verse
    assert len(restored.sections[0].chords) == 1
    assert len(restored.slots) == 1
    assert restored.slots[0].track_name == SlotTrack.melody


def test_section_labels():
    """All section labels from the design doc are valid."""
    for label in ["intro", "verse", "chorus", "bridge", "instrumental", "solo", "outro", "break"]:
        assert SectionLabel(label)
