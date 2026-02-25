"""
Song Outline assembler.

Takes outputs from all four analysis steps (Demucs, Essentia, madmom,
All-In-One) and merges them into a unified SongOutline.
"""

from __future__ import annotations

from pathlib import Path

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
    StemPaths,
)


# Slot priority: lower = prompted to user first, higher = agent fills first
SLOT_PRIORITIES = {
    SlotTrack.melody: 1,
    SlotTrack.chords: 2,
    SlotTrack.bass: 3,
    SlotTrack.pad: 4,
    SlotTrack.drums: 5,
}


def assemble_outline(
    source_path: Path,
    stem_paths: dict[str, str],
    key_result: dict,
    beat_result: dict,
    structure_result: dict,
) -> SongOutline:
    """
    Merge analysis results into a complete SongOutline.

    This function:
    1. Creates Section objects from structure segmentation, with chords
       mapped from the beat-aligned chord progression.
    2. Generates Slot definitions for each track/section combination.
    3. Builds the complete outline with key, tempo, beats, sections, slots.
    """
    # Build sections with chord events mapped to each
    beats = beat_result["beats"]
    chords = beat_result["chords"]
    sections: list[Section] = []

    for seg in structure_result["sections"]:
        # Find the beat indices that fall within this section
        start_beat = _find_nearest_beat(beats, seg["start_time"])
        end_beat = _find_nearest_beat(beats, seg["end_time"])

        # Filter chords that overlap this section
        section_chords = [
            ChordEvent(
                chord=c["chord"],
                start_time=max(c["start_time"], seg["start_time"]),
                end_time=min(c["end_time"], seg["end_time"]),
                start_beat=_find_nearest_beat(beats, max(c["start_time"], seg["start_time"])),
                end_beat=_find_nearest_beat(beats, min(c["end_time"], seg["end_time"])),
            )
            for c in chords
            if c["start_time"] < seg["end_time"] and c["end_time"] > seg["start_time"]
        ]

        section = Section(
            label=SectionLabel(seg["label"]),
            start_time=seg["start_time"],
            end_time=seg["end_time"],
            start_beat=start_beat,
            end_beat=end_beat,
            chords=section_chords,
        )
        sections.append(section)

    # Generate slots: each track type gets a slot spanning all sections
    # where it's musically relevant
    slots = _generate_slots(sections)

    # Get audio duration from beat data or structure
    duration = max(
        (seg["end_time"] for seg in structure_result["sections"]),
        default=0.0,
    )

    return SongOutline(
        source_track=SourceTrackInfo(
            filename=source_path.name,
            duration=duration,
        ),
        key=KeyInfo(
            tonic=key_result["tonic"],
            mode=key_result["mode"],
            confidence=key_result["confidence"],
        ),
        tempo=TempoInfo(
            bpm=beat_result["bpm"],
            confidence=beat_result.get("bpm_confidence", 0.8),
        ),
        beats=beats,
        downbeats=beat_result.get("downbeats", []),
        sections=sections,
        slots=slots,
        stems=StemPaths(**stem_paths),
    )


def _generate_slots(sections: list[Section]) -> list[Slot]:
    """
    Generate slot definitions based on sections.

    - melody: verse, chorus, solo
    - bass: all sections
    - chords: all sections
    - drums: uses Demucs stem, but slot exists for override
    - pad: bridge, intro, outro
    """
    melody_sections = [
        s.id for s in sections if s.label in (
            SectionLabel.verse, SectionLabel.chorus, SectionLabel.solo
        )
    ]
    pad_sections = [
        s.id for s in sections if s.label in (
            SectionLabel.intro, SectionLabel.bridge, SectionLabel.outro
        )
    ]
    all_section_ids = [s.id for s in sections]

    slots: list[Slot] = []

    if melody_sections:
        slots.append(Slot(
            track_name=SlotTrack.melody,
            section_ids=melody_sections,
            priority=SLOT_PRIORITIES[SlotTrack.melody],
        ))

    slots.append(Slot(
        track_name=SlotTrack.chords,
        section_ids=all_section_ids,
        priority=SLOT_PRIORITIES[SlotTrack.chords],
    ))

    slots.append(Slot(
        track_name=SlotTrack.bass,
        section_ids=all_section_ids,
        priority=SLOT_PRIORITIES[SlotTrack.bass],
    ))

    if pad_sections:
        slots.append(Slot(
            track_name=SlotTrack.pad,
            section_ids=pad_sections,
            priority=SLOT_PRIORITIES[SlotTrack.pad],
        ))

    slots.append(Slot(
        track_name=SlotTrack.drums,
        section_ids=all_section_ids,
        priority=SLOT_PRIORITIES[SlotTrack.drums],
    ))

    return slots


def _find_nearest_beat(beats: list[float], time: float) -> int:
    """Find the index of the beat nearest to the given time."""
    if not beats:
        return 0
    min_dist = float("inf")
    nearest = 0
    for i, beat_time in enumerate(beats):
        dist = abs(beat_time - time)
        if dist < min_dist:
            min_dist = dist
            nearest = i
    return nearest
