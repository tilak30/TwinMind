"use client";

import { useCallback, useRef, useState } from "react";
import { transcribeAudioChunk } from "@/lib/groqClient";
import { useTwinMindStore } from "@/store/useTwinMindStore";
import { scheduleSuggestionRefresh } from "@/services/suggestionEngine";

/** Each completed segment is ~this long (full container, valid for Whisper). */
const SEGMENT_MS = 30_000;
/**
 * Timeslice blobs from MediaRecorder are NOT standalone WebM files (only the first has headers).
 * We stop/restart the recorder so every upload is one complete media file.
 */
const MIN_TRANSCRIBE_BYTES = 512;

export function useMeetingRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPipelineBusy, setIsPipelineBusy] = useState(false);

  const wantsRecordingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const segmentRecorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queueRef = useRef<Blob[]>([]);
  const processingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsPipelineBusy(true);
    try {
      while (queueRef.current.length > 0) {
        const blob = queueRef.current.shift()!;

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
            await scheduleSuggestionRefresh("transcript");
          }
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Transcription failed — check mic permissions and Groq STT limits.";
          useTwinMindStore.setState({ sessionError: `STT: ${message}` });
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
    (blob: Blob) => {
      if (blob.size === 0) return;
      queueRef.current.push(blob);
      void processQueue();
    },
    [processQueue],
  );

  const beginSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!wantsRecordingRef.current) {
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setIsRecording(false);
      return;
    }
    if (!stream) {
      setIsRecording(false);
      return;
    }

    const options: MediaRecorderOptions = {};
    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        options.mimeType = "audio/webm";
      }
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
        enqueueBlob(blob);
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

  const start = useCallback(async () => {
    const apiKey = useTwinMindStore.getState().groqApiKey.trim();
    if (!apiKey) {
      useTwinMindStore.setState({
        sessionError: "Add your Groq API key in Settings before starting the microphone.",
      });
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      wantsRecordingRef.current = true;
      setIsRecording(true);
      useTwinMindStore.setState({ sessionError: null });
      beginSegment();
    } catch (e) {
      wantsRecordingRef.current = false;
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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
    }
  }, []);

  return { isRecording, isPipelineBusy, start, stop };
}
