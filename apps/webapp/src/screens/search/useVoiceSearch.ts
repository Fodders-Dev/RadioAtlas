import { useCallback, useEffect, useRef, useState } from 'react';
import { getTelegramWebApp } from '../../lib/telegram';

/**
 * Voice search — three gates, and a hard rule: if ANY gate fails, the button
 * renders NOTHING. No disabled button, no "не поддерживается" toast. A control
 * that does nothing is worse than no control.
 *
 * Why the gates are not just a constructor check: Telegram on iOS is a
 * WKWebView, which exposes no SpeechRecognition at all. Telegram on Android is
 * the Android System WebView, where `webkitSpeechRecognition` is often present
 * AS A CONSTRUCTOR while the speech service behind it is not wired up — it
 * constructs happily, then fires error 'network' or 'service-not-allowed'.
 * Feature-detection alone therefore ships exactly the dead button we are trying
 * to avoid, which is what gate 3 exists to catch.
 */

const UNSUPPORTED_KEY = 'radio:voice-unsupported:v1';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const readCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
};

const readSelfDisabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(UNSUPPORTED_KEY) === '1';
  } catch {
    return false;
  }
};

const writeSelfDisabled = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UNSUPPORTED_KEY, '1');
  } catch {
    // ignore storage failures
  }
};

// Gate 2 — known-dead hosts. Telegram's iOS/macOS clients are WKWebView, where
// the API is absent or permanently non-functional.
const isKnownDeadHost = () => {
  const platform = String(getTelegramWebApp()?.platform || '').toLowerCase();
  return platform === 'ios' || platform === 'macos';
};

type UseVoiceSearchOptions = {
  /** Applied to the query. MUST NOT start playback (#86). */
  onTranscript: (value: string) => void;
  locale?: string;
};

export const useVoiceSearch = ({ onTranscript, locale }: UseVoiceSearchOptions) => {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [denied, setDenied] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    setSupported(Boolean(readCtor()) && !isKnownDeadHost() && !readSelfDisabled());
  }, []);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    []
  );

  const start = useCallback(() => {
    const Ctor = readCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setListening(false);
      return;
    }

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new Ctor();
    } catch {
      // Constructing threw — the surface is a stub. Never offer it again.
      writeSelfDisabled();
      setSupported(false);
      return;
    }

    recognition.lang = locale === 'en' ? 'en-US' : 'ru-RU';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
      // Fills the query and nothing else. No play call, no auto-submit beyond
      // the search box's existing debounce (#86).
      if (transcript) onTranscriptRef.current(transcript);
    };

    recognition.onerror = (event) => {
      const error = String(event?.error || '');
      if (error === 'not-allowed') {
        // The only case worth surfacing: the user denied the mic, which is
        // actionable and recoverable.
        setDenied(true);
      } else if (error === 'service-not-allowed' || error === 'network') {
        // Gate 3 — the constructor lied. Cost of the lie: one dead tap, once,
        // ever, on this device.
        writeSelfDisabled();
        setSupported(false);
      }
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setDenied(false);
      setListening(true);
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }, [locale]);

  return { supported, listening, denied, start };
};
