/**
 * Builds the dynamic system prompt for the Conductor's Claude calls.
 *
 * Includes song context, musical guidelines, MIDI format spec,
 * session state, and section-ahead planning instructions.
 */

import type { PerformanceOutline, PerformanceSection } from "./performance-outline";

// ---------------------------------------------------------------------------
// Types for session state summary
// ---------------------------------------------------------------------------

export interface SlotSummary {
  slot_id: string;
  track: string;
  section_id: string;
  source: string | null;
  event_count: number;
}

export interface SessionStateSummary {
  slots: SlotSummary[];
  mutedStems: string[];
  activeStem: string | null;
  mutedTracks: string[];
  soloedTracks: string[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for a Claude call.
 *
 * @param outline - The PerformanceOutline (doubled sections)
 * @param sessionState - Current state of all slots and mix
 * @param currentSectionIndex - The section currently playing (-1 if not playing)
 * @param planningForIndex - The section index to plan for (next section)
 */
export function buildSystemPrompt(
  outline: PerformanceOutline,
  sessionState: SessionStateSummary,
  currentSectionIndex: number,
  planningForIndex: number
): string {
  const { original } = outline;

  const parts: string[] = [];

  // -----------------------------------------------------------------------
  // Role & context
  // -----------------------------------------------------------------------
  parts.push(`You are a musical co-performer in a collaborative session.
You are performing alongside a human musician, contributing MIDI parts and managing the mix in real-time.
Your goal is to create a compelling, evolving musical arrangement that complements what the human plays.`);

  // -----------------------------------------------------------------------
  // Song info
  // -----------------------------------------------------------------------
  parts.push(`
## Song Information
- Key: ${original.key.tonic} ${original.key.mode}
- Tempo: ${original.tempo.bpm} BPM
- Time Signature: ${original.time_signature.numerator}/${original.time_signature.denominator}
- Original Duration: ${original.source_track.duration.toFixed(1)}s
- Performance Duration: ${outline.totalDuration.toFixed(1)}s (each section is doubled)`);

  // -----------------------------------------------------------------------
  // Section map
  // -----------------------------------------------------------------------
  parts.push(`
## Performance Sections
Each section is 2x the original duration — the chord progression loops at the midpoint.
`);

  for (let i = 0; i < outline.sections.length; i++) {
    const s = outline.sections[i];
    const marker =
      i === currentSectionIndex ? " ◀ NOW PLAYING" :
      i === planningForIndex ? " ◀ PLAN FOR THIS" : "";
    parts.push(
      `### ${i + 1}. ${s.label.toUpperCase()} (${s.id})${marker}
  Time: ${s.start_time.toFixed(1)}s – ${s.end_time.toFixed(1)}s (midpoint: ${s.midpoint.toFixed(1)}s)
  Chords: ${formatChordProgression(s)}`
    );
  }

  // -----------------------------------------------------------------------
  // MIDI format spec
  // -----------------------------------------------------------------------
  parts.push(`
## MIDI Format
When using generate_midi, each event has:
- note: MIDI note number 0-127 (middle C = 60, C3 = 48, C5 = 72)
- velocity: 0-127 (pp=40, mp=64, mf=80, f=100, ff=120)
- time: seconds from the START of the performance section (not from song start)
- duration: seconds

For drums track, use General MIDI drum map:
- Bass drum: 36, Snare: 38, Closed hi-hat: 42, Open hi-hat: 46
- Ride: 51, Crash: 49, Low tom: 45, Mid tom: 47, High tom: 50`);

  // -----------------------------------------------------------------------
  // Musical guidelines
  // -----------------------------------------------------------------------
  parts.push(`
## Musical Guidelines
- Stay in the song's key (${original.key.tonic} ${original.key.mode}). Use chord tones on strong beats.
- Complement what the human plays — don't compete. If they play melody, support with harmony or rhythm.
- Build the arrangement across sections — start sparse, add layers, create dynamics.
- Use velocity variation for expression. Avoid everything at velocity 100.
- For bass: root notes on beat 1, walking patterns, octave jumps for energy.
- For chords: voicings in the C3-C5 range, rhythmic variation between sections.
- For melody: singable phrases, motifs that repeat and develop.
- For pads: sustained notes, slow-moving harmony, gentle velocity.
- For drums: groove first, fills on section boundaries.`);

  // -----------------------------------------------------------------------
  // Stem policy
  // -----------------------------------------------------------------------
  parts.push(`
## Original Stems
The song's original stems (vocals, drums, bass, other) are available.
**Max 1 original stem should be audible at a time.** When unmuting a stem, mute the others first.
Use stems strategically — feature the original drums during a breakdown, or bring in vocals for a chorus.`);

  // -----------------------------------------------------------------------
  // Current session state
  // -----------------------------------------------------------------------
  parts.push(`
## Current Session State`);

  if (sessionState.activeStem) {
    parts.push(`Active stem: ${sessionState.activeStem}`);
  } else {
    parts.push(`Active stem: none (all muted)`);
  }

  if (sessionState.mutedTracks.length > 0) {
    parts.push(`Muted synth tracks: ${sessionState.mutedTracks.join(", ")}`);
  }
  if (sessionState.soloedTracks.length > 0) {
    parts.push(`Soloed synth tracks: ${sessionState.soloedTracks.join(", ")}`);
  }

  parts.push(`\nSlot status:`);
  for (const section of outline.sections) {
    const sectionSlots = sessionState.slots.filter(
      (s) => s.section_id === section.id
    );
    const filledSlots = sectionSlots.filter((s) => s.source !== null);
    if (filledSlots.length > 0) {
      const details = filledSlots
        .map((s) => `${s.track}(${s.source}, ${s.event_count} events)`)
        .join(", ");
      parts.push(`  ${section.label} (${section.id}): ${details}`);
    } else {
      parts.push(`  ${section.label} (${section.id}): all empty`);
    }
  }

  // -----------------------------------------------------------------------
  // Planning instructions
  // -----------------------------------------------------------------------
  if (planningForIndex >= 0 && planningForIndex < outline.sections.length) {
    const planSection = outline.sections[planningForIndex];
    parts.push(`
## Your Task
Plan your contribution for the **${planSection.label}** section (${planSection.id}).
The chord progression is: ${formatChordProgression(planSection)}
Section duration: ${(planSection.end_time - planSection.start_time).toFixed(1)}s

Use generate_midi to create MIDI for any tracks you want to contribute to in this section.
Use mute_stem / set_stem_volume if you want to change which original stem is active.
Use suggest_to_human if you have guidance for the human performer.

Consider what the human has played so far and how your contribution will build on it.`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Draft arrangement prompt
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the initial draft arrangement call.
 * Claude fills every slot with a minimal but musical draft.
 */
export function buildDraftPrompt(
  outline: PerformanceOutline
): string {
  const { original } = outline;

  const parts: string[] = [];

  parts.push(`You are a musical arranger creating an initial draft for a collaborative performance.
The human performer will later override and adapt these parts, so keep them SIMPLE and SUPPORTIVE.

## Song Information
- Key: ${original.key.tonic} ${original.key.mode}
- Tempo: ${original.tempo.bpm} BPM
- Time Signature: ${original.time_signature.numerator}/${original.time_signature.denominator}
- Performance Duration: ${outline.totalDuration.toFixed(1)}s`);

  parts.push(`
## Performance Sections`);

  for (const s of outline.sections) {
    parts.push(
      `### ${s.label.toUpperCase()} (${s.id})
  Time: ${s.start_time.toFixed(1)}s – ${s.end_time.toFixed(1)}s (midpoint: ${s.midpoint.toFixed(1)}s)
  Chords: ${formatChordProgression(s)}`
    );
  }

  parts.push(`
## MIDI Format
Same as before: note (0-127), velocity (0-127), time (seconds from section start), duration (seconds).
General MIDI drum map for drums track.`);

  parts.push(`
## Your Task
Generate a draft arrangement for ALL sections. For each section, create MIDI for these tracks:
- **drums**: Simple groove appropriate for the section energy
- **bass**: Root-note patterns following the chord progression
- **chords**: Basic chord voicings with appropriate rhythm
- **pad**: Sustained harmony (optional, use for choruses and bridges)
- **melody**: Leave EMPTY for the human to fill

Keep parts SIMPLE — this is a starting point. Use 2-4 notes per bar for bass, basic patterns for drums.
Build dynamics across sections: sparse intro → fuller verse → energetic chorus → etc.

Also decide which original stem (if any) to feature at the start with mute_stem calls.
Start with all stems muted, then unmute at most 1.

Use generate_midi for each slot. Slot IDs follow the format: "{track}_perf_{sectionId}"
Example: "drums_perf_intro_1", "bass_perf_verse_1"`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatChordProgression(section: PerformanceSection): string {
  if (section.chords.length === 0) return "(no chords)";

  // Show unique chord names in order (deduplicated from the doubled version)
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of section.chords) {
    if (!seen.has(c.chord)) {
      seen.add(c.chord);
      unique.push(c.chord);
    }
  }
  return unique.join(" → ");
}
