import { useState, useCallback, useRef } from 'react';

interface UseVoiceInputOptions {
  /** Called with the final transcript when recognition ends */
  onTranscript: (text: string) => void;
  /** BCP-47 language tag, e.g. 'pt-BR', 'en-US'. Defaults to browser language. */
  lang?: string;
}

interface UseVoiceInputReturn {
  isRecording: boolean;
  isSupported: boolean;
  toggle: () => void;
  stop: () => void;
}

export function useVoiceInput({ onTranscript, lang }: UseVoiceInputOptions): UseVoiceInputReturn {
  const SR = typeof window !== 'undefined'
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;

  const isSupported = Boolean(SR);
  const [isRecording, setIsRecording] = useState(false);
  const recRef = useRef<any>(null);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch {}
    recRef.current = null;
    setIsRecording(false);
  }, []);

  const start = useCallback(() => {
    if (!SR) return;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = lang ?? navigator.language ?? 'pt-BR';

    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as SpeechRecognitionResultList)
        .map((r: SpeechRecognitionResult) => r[0].transcript)
        .join(' ')
        .trim();
      if (transcript) onTranscript(transcript);
    };

    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);

    recRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, [SR, lang, onTranscript]);

  const toggle = useCallback(() => {
    if (isRecording) stop();
    else start();
  }, [isRecording, start, stop]);

  return { isRecording, isSupported, toggle, stop };
}
