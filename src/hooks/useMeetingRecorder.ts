/**
 * useMeetingRecorder.ts
 *
 * React hook that manages the full audio capture + transcription pipeline.
 *
 * Audio strategy — stop/restart segmentation:
 *   MediaRecorder is started and stopped every SEGMENT_MS (30 seconds).
 *   Each stop event produces a complete, self-contained WebM blob that
 *   Whisper can decode reliably. Timeslice-based approaches were avoided
 *   because they produce partial WebM headers that cause Whisper 400 errors.
 *
 * Transcription queue:
 *   Blobs are pushed into a FIFO queue and processed serially so that a slow
 *   Whisper response never causes out-of-order transcript appends.
 *
 * Flush mechanism:
 *   The hook registers a flushRecorderSegment callback in the Zustand store.
 *   The suggestion engine calls this when the user clicks "Reload suggestions"
 *   so the latest partial segment is transcribed before generating new cards.
 *
 * Exposed API:
 *   - isRecording:       whether a recording session is active.
 *   - isPipelineBusy:    whether a Whisper request is in flight.
 *   - start(source):     begin recording from mic or system audio.
 *   - stop():            stop recording and flush any remaining blobs.
 *   - flushCurrentSegment: force-complete and transcribe the open segment.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudioChunk } from "@/lib/groqClient";
import { useTwinMindStore } from "@/store/useTwinMindStore";
import { scheduleSuggestionRefresh } from "@/services/suggestionEngine";

export type CaptureSource = "mic" | "system";

/** Each completed segment is ~this long (full container, valid for Whisper). */
const SEGMENT_MS = 30_000;
/**
 * Timeslice blobs from MediaRecorder are NOT standalone WebM files (only the first has headers).
 * We stop/restart the recorder so every upload is one complete media file.
 */
const MIN_TRANSCRIBE_BYTES = 512;

/**
 * `navigator.mediaDevices` is undefined in SSR and on many **non-secure** pages
 * (e.g. `http://192.168.x.x` — only `https://` and `http://localhost` are treated as secure for mic).
 */
function getMediaStream(constraints: MediaStreamConstraints): Promise<MediaStream> | null {
  if (typeof navigator === "undefined") return null;
  const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (getUserMedia) {
    return getUserMedia(constraints);
  }
  return null;
}

function getDisplayStream(constraints: DisplayMediaStreamOptions): Promise<MediaStream> | null {
  if (typeof navigator === "undefined") return null;
  const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
  if (getDisplayMedia) {
    return getDisplayMedia(constraints);
  }
  return null;
}

const MIC_UNAVAILABLE_MESSAGE =
  "Microphone API is unavailable. Open the app on https:// or http://localhost (not plain http on a LAN IP). Use a current Chrome, Edge, or Firefox, allow mic permission, and avoid strict iframe/embed blocks.";
const SYSTEM_AUDIO_UNAVAILABLE_MESSAGE =
  "Tab audio capture is unavailable. Use Chrome or Edge 105+, select a browser tab in the audio picker, and allow audio sharing when prompted.";

function setRecordingActive(active: boolean) {
  useTwinMindStore.getState().setRecordingActive(active);
}

export function useMeetingRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPipelineBusy, setIsPipelineBusy] = useState(false);

  const wantsRecordingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const segmentRecorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueRef = useRef<Array<{ blob: Blob; triggerSuggestions: boolean; done?: () => void }>>([]);
  const processingRef = useRef(false);
  const flushInProgressRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsPipelineBusy(true);
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift()!;
        const blob = item.blob;

        const apiKey = useTwinMindStore.getState().groqApiKey.trim();
        if (!apiKey) {
          useTwinMindStore.setState({
            sessionError: "Missing Groq API key — open Settings to add your key.",
          });
          continue;
        }

        if (blob.size < MIN_TRANSCRIBE_BYTES) {
          continue;
        }

        try {
          const text = await transcribeAudioChunk(apiKey, blob);
          if (text.trim()) {
            useTwinMindStore.getState().appendTranscriptChunk({
              text,
              createdAt: new Date().toISOString(),
            });
            if (item.triggerSuggestions) {
              // Do not block recorder pipeline on suggestion generation.
              // Suggestion engine already serializes requests internally.
              void scheduleSuggestionRefresh("transcript");
            }
          }
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Transcription failed — check mic permissions and Groq STT limits.";
          useTwinMindStore.setState({ sessionError: `STT: ${message}` });
        } finally {
          item.done?.();
        }
      }
    } finally {
      processingRef.current = false;
      setIsPipelineBusy(false);
      if (queueRef.current.length > 0) {
        void processQueue();
      }
    }
  }, []);

  const enqueueBlob = useCallback(
    (blob: Blob, options?: { triggerSuggestions?: boolean }) =>
      new Promise<void>((resolve) => {
        if (blob.size === 0) {
          resolve();
          return;
        }
        queueRef.current.push({
          blob,
          triggerSuggestions: options?.triggerSuggestions ?? true,
          done: resolve,
        });
        void processQueue();
      }),
    [processQueue],
  );

  const beginSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!wantsRecordingRef.current) {
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setIsRecording(false);
      setRecordingActive(false);
      return;
    }
    if (!stream) {
      setIsRecording(false);
      setRecordingActive(false);
      return;
    }

    const options: MediaRecorderOptions = {};
    if (typeof MediaRecorder === "undefined") {
      useTwinMindStore.setState({
        sessionError: "MediaRecorder is not supported in this browser.",
      });
      wantsRecordingRef.current = false;
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setIsRecording(false);
      setRecordingActive(false);
      return;
    }
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      options.mimeType = "audio/webm;codecs=opus";
    } else if (MediaRecorder.isTypeSupported("audio/webm")) {
      options.mimeType = "audio/webm";
    }

    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, options);
    segmentRecorderRef.current = rec;

    rec.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    rec.addEventListener("stop", () => {
      if (segmentTimerRef.current) {
        clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      segmentRecorderRef.current = null;

      const mimeType = rec.mimeType || options.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });

      if (blob.size >= MIN_TRANSCRIBE_BYTES) {
        void enqueueBlob(blob, {
          // Manual "get suggestions now" flush will run suggestions after this transcribe.
          triggerSuggestions: !flushInProgressRef.current,
        });
      }

      // Re-check wantsRecording after this tick so Stop wins over auto-restart.
      queueMicrotask(() => {
        const streamNow = streamRef.current;
        const alive =
          streamNow?.getAudioTracks().some((t) => t.readyState === "live") ?? false;
        if (wantsRecordingRef.current && alive) {
          beginSegment();
        } else {
          streamNow?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          setIsRecording(false);
          setRecordingActive(false);
        }
      });
    });

    rec.start();

    segmentTimerRef.current = setTimeout(() => {
      if (rec.state === "recording") {
        rec.stop();
      }
    }, SEGMENT_MS);
  }, [enqueueBlob]);

  const flushCurrentSegment = useCallback(async () => {
    const rec = segmentRecorderRef.current;
    if (!wantsRecordingRef.current || !rec || rec.state !== "recording") {
      return;
    }
    flushInProgressRef.current = true;
    rec.stop();
    try {
      // Wait for recorder stop event to enqueue blob.
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      // Wait until queue (including the just-flushed segment) is fully processed.
      while (processingRef.current || queueRef.current.length > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 60));
      }
    } finally {
      flushInProgressRef.current = false;
    }
  }, []);

  useEffect(() => {
    useTwinMindStore.getState().setFlushRecorderSegment(flushCurrentSegment);
    return () => {
      useTwinMindStore.getState().setFlushRecorderSegment(null);
    };
  }, [flushCurrentSegment]);

  const start = useCallback(async (source: CaptureSource = "mic") => {
    const apiKey = useTwinMindStore.getState().groqApiKey.trim();
    if (!apiKey) {
      useTwinMindStore.setState({
        sessionError: "Add your Groq API key in Settings before starting the microphone.",
      });
      return;
    }

    let stream: MediaStream | null = null;
    try {
      const pending =
        source === "system"
          ? getDisplayStream({
              /**
               * video: false requests audio-only capture so Chrome/Edge show a
               * tab-audio picker — no screen needs to be shared.
               * Note: some browsers (Safari) may still require video; we handle
               * the "no audio track" case below.
               */
              video: false,
              audio: true,
            })
          : getMediaStream({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
              },
            });
      if (!pending) {
        useTwinMindStore.setState({
          sessionError: source === "system" ? SYSTEM_AUDIO_UNAVAILABLE_MESSAGE : MIC_UNAVAILABLE_MESSAGE,
        });
        return;
      }
      const selectedStream = await pending;
      if (source === "system") {
        const audioTracks = selectedStream.getAudioTracks();
        // Stop any unexpected video tracks (e.g. browsers that still send video).
        selectedStream.getVideoTracks().forEach((t) => t.stop());
        if (!audioTracks.length) {
          selectedStream.getTracks().forEach((t) => t.stop());
          throw new Error(
            "No audio track found. In the picker, select a browser tab and confirm audio sharing is enabled.",
          );
        }
        stream = new MediaStream(audioTracks);
        audioTracks[0].addEventListener("ended", () => {
          wantsRecordingRef.current = false;
          if (segmentTimerRef.current) {
            clearTimeout(segmentTimerRef.current);
          }
          segmentTimerRef.current = null;
          if (segmentRecorderRef.current?.state === "recording") {
            segmentRecorderRef.current.stop();
          }
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          setIsRecording(false);
          setRecordingActive(false);
          useTwinMindStore.setState({
            sessionError: "Tab audio sharing ended. Start again to continue transcription.",
          });
        });
      } else {
        stream = selectedStream;
      }
      streamRef.current = stream;
      wantsRecordingRef.current = true;
      setIsRecording(true);
      setRecordingActive(true);
      useTwinMindStore.setState({ sessionError: null });
      beginSegment();
    } catch (e) {
      wantsRecordingRef.current = false;
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setRecordingActive(false);
      const message = e instanceof Error ? e.message : "Unable to access microphone";
      useTwinMindStore.setState({ sessionError: message });
    }
  }, [beginSegment]);

  const stop = useCallback(() => {
    wantsRecordingRef.current = false;

    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }

    const rec = segmentRecorderRef.current;
    if (rec && rec.state === "recording") {
      rec.stop();
    } else {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setIsRecording(false);
      setRecordingActive(false);
    }
  }, []);

  return { isRecording, isPipelineBusy, start, stop };
}
