/**
 * React hook for Web MIDI device management.
 *
 * Provides a list of available MIDI input devices, the selected device,
 * and whether MIDI is supported in this browser.
 */

import { useState, useEffect, useCallback } from "react";
import { getMidiInput, type MidiDevice } from "@/audio/midi-input";

interface UseMidiDevicesResult {
  devices: MidiDevice[];
  selectedId: string | null;
  select: (id: string) => void;
  isSupported: boolean;
  isInitialized: boolean;
}

export function useMidiDevices(): UseMidiDevicesResult {
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const midi = getMidiInput();

    const initialize = async () => {
      const supported = await midi.init();
      setIsSupported(supported);
      setIsInitialized(true);

      if (supported) {
        setDevices(midi.getInputs());

        // Auto-select the first device if available
        const inputs = midi.getInputs();
        if (inputs.length > 0) {
          midi.selectInput(inputs[0].id);
          setSelectedId(inputs[0].id);
        }
      }
    };

    initialize();

    // Listen for hot-plug events
    const unsub = midi.onStateChange(() => {
      setDevices(midi.getInputs());
    });

    return () => {
      unsub();
    };
  }, []);

  const select = useCallback((id: string) => {
    const midi = getMidiInput();
    midi.selectInput(id);
    setSelectedId(id);
  }, []);

  return { devices, selectedId, select, isSupported, isInitialized };
}
