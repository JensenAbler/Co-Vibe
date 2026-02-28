/**
 * Web MIDI API wrapper for receiving MIDI input from external devices.
 *
 * Handles device enumeration, hot-plug detection, and note parsing.
 * Unsupported browsers are handled gracefully (MIDI is optional).
 */

export type MidiNoteHandler = (
  note: number,
  velocity: number,
  isNoteOn: boolean
) => void;

export interface MidiDevice {
  id: string;
  name: string;
}

export class MidiInput {
  private access: MIDIAccess | null = null;
  private activeInput: MIDIInput | null = null;
  private handlers = new Set<MidiNoteHandler>();
  private stateChangeHandlers = new Set<() => void>();

  /**
   * Request MIDI access from the browser.
   * Returns false if MIDI is not supported.
   */
  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess();
      this.access.onstatechange = () => {
        for (const handler of this.stateChangeHandlers) {
          handler();
        }
      };
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available MIDI input devices.
   */
  getInputs(): MidiDevice[] {
    if (!this.access) return [];

    const devices: MidiDevice[] = [];
    for (const [id, input] of this.access.inputs) {
      devices.push({ id, name: input.name ?? `MIDI Device ${id}` });
    }
    return devices;
  }

  /**
   * Connect to a specific MIDI input device by ID.
   */
  selectInput(inputId: string): void {
    if (!this.access) return;

    // Disconnect existing input
    if (this.activeInput) {
      (this.activeInput as unknown as MIDIInput).onmidimessage = null;
      this.activeInput = null;
    }

    const input = this.access.inputs.get(inputId);
    if (!input) return;

    input.onmidimessage = (event: MIDIMessageEvent) => {
      this.handleMessage(event);
    };
    this.activeInput = input as unknown as MIDIInput;
  }

  /**
   * Subscribe to note events. Returns an unsubscribe function.
   */
  onNote(handler: MidiNoteHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Subscribe to device state changes (connect/disconnect).
   */
  onStateChange(handler: () => void): () => void {
    this.stateChangeHandlers.add(handler);
    return () => this.stateChangeHandlers.delete(handler);
  }

  private handleMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) return;

    const status = data[0] & 0xf0; // Strip channel
    const note = data[1];
    const velocity = data[2];

    if (status === 0x90 && velocity > 0) {
      // Note On
      for (const handler of this.handlers) {
        handler(note, velocity, true);
      }
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      // Note Off (0x80 or Note On with velocity 0)
      for (const handler of this.handlers) {
        handler(note, 0, false);
      }
    }
  }

  dispose(): void {
    if (this.activeInput) {
      (this.activeInput as unknown as MIDIInput).onmidimessage = null;
      this.activeInput = null;
    }
    this.handlers.clear();
    this.stateChangeHandlers.clear();
    this.access = null;
  }
}

// Module-level singleton
let midiInputInstance: MidiInput | null = null;

export function getMidiInput(): MidiInput {
  if (!midiInputInstance) {
    midiInputInstance = new MidiInput();
  }
  return midiInputInstance;
}
