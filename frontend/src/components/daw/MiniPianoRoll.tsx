/**
 * Mini piano roll — renders recorded MIDI events as tiny colored blocks
 * inside a slot's timeline segment.
 */

import type { SlotRecording } from "@/types/session";

interface MiniPianoRollProps {
  recording: SlotRecording;
  /** Duration of the section this slot spans, in seconds */
  sectionDuration: number;
  /** CSS color class for the note blocks */
  colorClass: string;
}

export function MiniPianoRoll({
  recording,
  sectionDuration,
  colorClass,
}: MiniPianoRollProps) {
  const events = recording.midi_events;
  if (events.length === 0) return null;

  // Find note range for vertical mapping
  let minNote = 127;
  let maxNote = 0;
  for (const e of events) {
    minNote = Math.min(minNote, e.note);
    maxNote = Math.max(maxNote, e.note);
  }
  const noteRange = Math.max(maxNote - minNote, 1);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {events.map((event, i) => {
        const left = sectionDuration > 0
          ? (event.time / sectionDuration) * 100
          : 0;
        const width = sectionDuration > 0
          ? Math.max((event.duration / sectionDuration) * 100, 0.5)
          : 0;
        // Map note to vertical position (higher notes at top)
        const bottom = ((event.note - minNote) / noteRange) * 80; // 80% of height
        const height = Math.max(100 / (noteRange + 4), 4); // min 4% height per note

        return (
          <div
            key={i}
            className={`absolute rounded-[1px] ${colorClass}`}
            style={{
              left: `${left}%`,
              width: `${width}%`,
              bottom: `${bottom + 10}%`,
              height: `${height}%`,
              opacity: 0.5 + (event.velocity / 127) * 0.5,
            }}
          />
        );
      })}
    </div>
  );
}
