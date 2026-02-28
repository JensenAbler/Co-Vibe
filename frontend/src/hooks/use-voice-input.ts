/**
 * React hook for vocoder voice input management.
 *
 * Provides enable/disable toggle for the vocoder and tracks
 * whether the browser supports getUserMedia.
 */

import { useState, useCallback } from "react";
import { getAudioEngine } from "@/audio/audio-engine";

interface UseVoiceInputResult {
  isSupported: boolean;
  isEnabled: boolean;
  enable: () => Promise<void>;
  disable: () => void;
}

export function useVoiceInput(): UseVoiceInputResult {
  const isSupported = !!navigator.mediaDevices?.getUserMedia;
  const [isEnabled, setIsEnabled] = useState(false);

  const enable = useCallback(async () => {
    const engine = getAudioEngine();
    const ok = await engine.enableVocoder();
    setIsEnabled(ok);
  }, []);

  const disable = useCallback(() => {
    const engine = getAudioEngine();
    engine.disableVocoder();
    setIsEnabled(false);
  }, []);

  return { isSupported, isEnabled, enable, disable };
}
