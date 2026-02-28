/**
 * Voice input — getUserMedia wrapper for microphone access.
 *
 * Mirrors the MidiInput singleton pattern. Provides a
 * MediaStreamAudioSourceNode for connecting to the vocoder.
 */

export class VoiceInput {
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private ctx: AudioContext | null = null;
  private stateHandlers = new Set<(active: boolean) => void>();

  /**
   * Request microphone access and create a source node.
   * Returns false if denied or unsupported.
   */
  async init(ctx: AudioContext): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      return false;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.ctx = ctx;
      this.sourceNode = ctx.createMediaStreamSource(this.stream);

      Array.from(this.stateHandlers).forEach((handler) => handler(true));

      return true;
    } catch {
      return false;
    }
  }

  getSourceNode(): MediaStreamAudioSourceNode | null {
    return this.sourceNode;
  }

  isActive(): boolean {
    return this.sourceNode !== null;
  }

  onStateChange(handler: (active: boolean) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  dispose(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    this.ctx = null;

    Array.from(this.stateHandlers).forEach((handler) => handler(false));
  }
}

// Module-level singleton
let voiceInputInstance: VoiceInput | null = null;

export function getVoiceInput(): VoiceInput {
  if (!voiceInputInstance) {
    voiceInputInstance = new VoiceInput();
  }
  return voiceInputInstance;
}
