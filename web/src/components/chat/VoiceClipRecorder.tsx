'use client';

// Voice-clip recorder — uses the MediaRecorder API to capture short audio
// clips (max 60s) and uploads the resulting Blob to the existing chat
// attachment endpoint. Closes audit Section F's "no voice messaging" gap.
//
// The recorder shows a live waveform during capture by sampling the
// AnalyserNode's frequency-domain data. We render a simple bar histogram
// — full canvas-based waveforms add bundle weight without much UX gain.
//
// No upload happens until the user clicks Send. Cancel discards the blob
// and stops the stream so the mic light goes off.

import { Loader2, Mic, Send, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAX_DURATION_SECONDS = 60;
const TICK_MS = 100;

type RecorderState = 'idle' | 'recording' | 'recorded' | 'uploading';

interface VoiceClipRecorderProps {
  /** Async upload — receives the blob. The parent decides which endpoint
   *  (existing chat attachment endpoint per services/chat repository). */
  onUpload: (blob: Blob, durationSeconds: number) => Promise<void>;
  className?: string;
}

export function VoiceClipRecorder({
  onUpload,
  className,
}: VoiceClipRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const startTimeRef = useRef<number>(0);
  const tickHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafHandleRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (tickHandleRef.current) {
      clearInterval(tickHandleRef.current);
      tickHandleRef.current = null;
    }
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        t.stop();
      });
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {
        // Ignore close errors
      });
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  function sampleLevels() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const arr = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(arr);
    // Bin the spectrum into 24 bars for a compact rail.
    const bars = 24;
    const stride = Math.max(1, Math.floor(arr.length / bars));
    const next: number[] = [];
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = 0; j < stride; j++) {
        const idx = i * stride + j;
        if (idx < arr.length) {
          const v = arr[idx];
          if (v !== undefined) sum += v;
        }
      }
      next.push(Math.min(1, sum / (stride * 255)));
    }
    setLevels(next);
    rafHandleRef.current = requestAnimationFrame(sampleLevels);
  }

  async function startRecording() {
    setError(null);
    // Some embedded browsers strip mediaDevices; tighten the runtime
    // check by re-narrowing through unknown so TS doesn't optimize the
    // branch away (jsdom in tests has neither).
    const md = (navigator as unknown as { mediaDevices?: MediaDevices })
      .mediaDevices;
    if (!md?.getUserMedia) {
      setError('Microphone access is not supported in this browser.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone permission denied.');
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      setError('Recording is not supported in this browser.');
      cleanup();
      return;
    }
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });
      blobRef.current = blob;
      setState('recorded');
    };

    // Wire up an analyser for the live waveform display. Re-narrow via
    // unknown so TS doesn't optimize the Safari fallback away.
    try {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const audioContextCtor = w.AudioContext ?? w.webkitAudioContext;
      if (!audioContextCtor) {
        throw new Error('AudioContext unavailable');
      }
      const ctx = new audioContextCtor();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      rafHandleRef.current = requestAnimationFrame(sampleLevels);
    } catch {
      // Non-fatal — recording proceeds without the visualizer.
    }

    recorder.start();
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    setState('recording');

    tickHandleRef.current = setInterval(() => {
      const ms = Date.now() - startTimeRef.current;
      setElapsedMs(ms);
      if (ms >= MAX_DURATION_SECONDS * 1000) {
        stopRecording();
      }
    }, TICK_MS);
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    cleanup();
  }

  function discardRecording() {
    blobRef.current = null;
    chunksRef.current = [];
    setElapsedMs(0);
    setLevels([]);
    setState('idle');
  }

  async function sendRecording() {
    const blob = blobRef.current;
    if (!blob) return;
    setState('uploading');
    setError(null);
    try {
      await onUpload(blob, Math.round(elapsedMs / 1000));
      blobRef.current = null;
      setElapsedMs(0);
      setLevels([]);
      setState('idle');
    } catch {
      setError('Upload failed.');
      setState('recorded');
    }
  }

  const seconds = Math.floor(elapsedMs / 1000);
  const fillPct = (elapsedMs / (MAX_DURATION_SECONDS * 1000)) * 100;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-input bg-background p-2',
        className,
      )}
      role="region"
      aria-label="Voice clip recorder"
    >
      {state === 'idle' ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => {
            void startRecording();
          }}
          aria-label="Start recording voice clip"
        >
          <Mic className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}

      {state === 'recording' ? (
        <>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="h-9 w-9"
            onClick={stopRecording}
            aria-label="Stop recording"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div
            className="flex h-6 flex-1 items-end gap-0.5 px-1"
            aria-label="Recording waveform"
            role="img"
          >
            {levels.map((lvl, i) => (
              <span
                key={`bar-${String(i)}`}
                className="block w-1 rounded-sm bg-primary"
                style={{ height: `${String(Math.max(8, lvl * 100))}%` }}
              />
            ))}
          </div>
          <span
            className="text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            0:{seconds.toString().padStart(2, '0')}
          </span>
          <span
            className="block h-1 w-16 overflow-hidden rounded bg-muted"
            aria-hidden="true"
          >
            <span
              className="block h-full bg-primary transition-all"
              style={{ width: `${String(Math.min(100, fillPct))}%` }}
            />
          </span>
        </>
      ) : null}

      {state === 'recorded' || state === 'uploading' ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={discardRecording}
            disabled={state === 'uploading'}
            aria-label="Discard recording"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="flex-1 text-xs text-muted-foreground">
            Voice clip · 0:{seconds.toString().padStart(2, '0')}
          </span>
          <Button
            type="button"
            size="icon"
            className="h-9 w-9"
            onClick={() => {
              void sendRecording();
            }}
            disabled={state === 'uploading'}
            aria-label="Send voice clip"
          >
            {state === 'uploading' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </>
      ) : null}

      {error ? (
        <span className="ml-2 text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
