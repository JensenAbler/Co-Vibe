/**
 * 16-band channel vocoder using native Web Audio API nodes.
 *
 * Signal path per band:
 *   Modulator: input → bandpass → gain(+6dB) → waveshaper(|x|) → LPF(20Hz) → envelope
 *   Carrier:   input → bandpass → gain (controlled by envelope) → output
 *
 * The envelope follower's output connects to the carrier band's GainNode.gain
 * at audio rate, giving the classic vocoder "talking synth" effect.
 */

const NUM_BANDS = 16;
const MIN_FREQ = 100;
const MAX_FREQ = 8000;
const ENVELOPE_LPF_FREQ = 20;
const MOD_BOOST = 2.0; // ~6dB
const DEFAULT_GAIN = 0.8;

interface VocoderBand {
  modFilter: BiquadFilterNode;
  modBoost: GainNode;
  modRectifier: WaveShaperNode;
  modEnvelope: BiquadFilterNode;
  carrierFilter: BiquadFilterNode;
  carrierAmp: GainNode;
}

export class Vocoder {
  private ctx: AudioContext;
  private bands: VocoderBand[] = [];
  private carrierOsc: OscillatorNode;
  private carrierGain: GainNode;
  private modulatorInput: GainNode;
  private outputGain: GainNode;
  private running = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // Output
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = DEFAULT_GAIN;

    // Modulator entry point
    this.modulatorInput = ctx.createGain();
    this.modulatorInput.gain.value = 1.0;

    // Carrier oscillator (sawtooth = harmonically rich for all bands)
    this.carrierOsc = ctx.createOscillator();
    this.carrierOsc.type = "sawtooth";
    this.carrierOsc.frequency.value = 220; // A3 default

    this.carrierGain = ctx.createGain();
    this.carrierGain.gain.value = 1.0;
    this.carrierOsc.connect(this.carrierGain);

    // Shared abs() waveshaper curve
    const curveLen = 65536;
    const curve = new Float32Array(curveLen);
    for (let i = 0; i < curveLen; i++) {
      curve[i] = Math.abs((2 * i) / curveLen - 1);
    }

    // Calculate logarithmically spaced band center frequencies
    const frequencies: number[] = [];
    for (let i = 0; i < NUM_BANDS; i++) {
      frequencies.push(
        MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / (NUM_BANDS - 1)),
      );
    }

    // Build the filter bank
    this.bands = frequencies.map((freq, i) => {
      // Q from adjacent band spacing
      const ratio = Math.pow(MAX_FREQ / MIN_FREQ, 1 / (NUM_BANDS - 1));
      const bandwidth = freq * (ratio - 1 / ratio);
      const Q = freq / bandwidth;

      // --- Modulator path ---
      const modFilter = ctx.createBiquadFilter();
      modFilter.type = "bandpass";
      modFilter.frequency.value = freq;
      modFilter.Q.value = Q;

      const modBoost = ctx.createGain();
      modBoost.gain.value = MOD_BOOST;

      const modRectifier = ctx.createWaveShaper();
      modRectifier.curve = curve;

      const modEnvelope = ctx.createBiquadFilter();
      modEnvelope.type = "lowpass";
      modEnvelope.frequency.value = ENVELOPE_LPF_FREQ;

      this.modulatorInput.connect(modFilter);
      modFilter.connect(modBoost);
      modBoost.connect(modRectifier);
      modRectifier.connect(modEnvelope);

      // --- Carrier path ---
      const carrierFilter = ctx.createBiquadFilter();
      carrierFilter.type = "bandpass";
      carrierFilter.frequency.value = freq;
      carrierFilter.Q.value = Q;

      const carrierAmp = ctx.createGain();
      carrierAmp.gain.value = 0; // Silent until modulator drives it

      this.carrierGain.connect(carrierFilter);
      carrierFilter.connect(carrierAmp);
      carrierAmp.connect(this.outputGain);

      // Audio-rate modulation: envelope → carrier gain
      modEnvelope.connect(carrierAmp.gain);

      return {
        modFilter,
        modBoost,
        modRectifier,
        modEnvelope,
        carrierFilter,
        carrierAmp,
      };
    });

    this.carrierOsc.start();
    this.running = true;
  }

  connectModulator(source: AudioNode): void {
    source.connect(this.modulatorInput);
  }

  disconnectModulator(source: AudioNode): void {
    try {
      source.disconnect(this.modulatorInput);
    } catch {
      // Already disconnected
    }
  }

  getOutput(): GainNode {
    return this.outputGain;
  }

  setCarrierFrequency(freq: number): void {
    if (!this.running) return;
    this.carrierOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02);
  }

  setGain(value: number): void {
    this.outputGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }

  getGain(): number {
    return this.outputGain.gain.value;
  }

  dispose(): void {
    this.running = false;

    try {
      this.carrierOsc.stop();
    } catch {
      // Already stopped
    }

    this.modulatorInput.disconnect();
    this.carrierGain.disconnect();
    this.outputGain.disconnect();

    for (const band of this.bands) {
      band.modFilter.disconnect();
      band.modBoost.disconnect();
      band.modRectifier.disconnect();
      band.modEnvelope.disconnect();
      band.carrierFilter.disconnect();
      band.carrierAmp.disconnect();
    }

    this.bands = [];
  }
}
