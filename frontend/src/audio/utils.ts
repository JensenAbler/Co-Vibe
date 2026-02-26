/**
 * Shared audio utilities.
 */

/**
 * Convert a MIDI note number to frequency in Hz.
 * A4 (note 69) = 440 Hz.
 */
export function midiNoteToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Fetch an audio file and decode it into an AudioBuffer.
 */
export async function fetchAndDecode(
  ctx: AudioContext,
  url: string
): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status} ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}

/**
 * Binary search for the index of the last beat at or before `time`.
 * Returns -1 if time is before the first beat.
 */
export function findBeatIndex(beats: number[], time: number): number {
  let lo = 0;
  let hi = beats.length - 1;
  let result = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (beats[mid] <= time) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}
