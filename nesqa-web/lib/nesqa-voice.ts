import type { NesqaChatResponse, NesqaStage } from "@/lib/nesqa-api";

const DEFAULT_VOICE_URL = "ws://localhost:8000/ws/voice";
const VOICE_SAMPLE_RATE = 24_000;

export type NesqaVoiceStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "recording"
  | "processing"
  | "speaking"
  | "error";

export type NesqaVoiceCallbacks = {
  onStatus: (status: NesqaVoiceStatus) => void;
  onSession: (sessionId: string, stage: NesqaStage) => void;
  onTranscript: (transcript: string, completed: boolean) => void;
  onResponse: (response: NesqaChatResponse, transcript: string) => void;
  onPlaybackComplete?: () => void;
  onError: (message: string, code?: string) => void;
};

type VoiceEvent = {
  type?: string;
  session_id?: string;
  stage?: NesqaStage;
  delta?: string;
  transcript?: string;
  audio?: string;
  response?: NesqaChatResponse;
  message?: string;
  code?: string;
};

function pcm16ToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return window.btoa(binary);
}

function base64ToPcm16(value: string): Int16Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer);
}

export class NesqaVoiceClient {
  private callbacks: NesqaVoiceCallbacks;
  private socket: WebSocket | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((reason: Error) => void) | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private muteNode: GainNode | null = null;
  private conversationActive = false;
  private captureEnabled = false;
  private transcript = "";
  private nextPlaybackTime = 0;
  private closeRequested = false;
  private startCancelled = false;
  private playbackTimer: number | null = null;

  constructor(callbacks: NesqaVoiceCallbacks) {
    this.callbacks = callbacks;
  }

  updateCallbacks(callbacks: NesqaVoiceCallbacks) {
    this.callbacks = callbacks;
  }

  async startConversation(sessionId: string | null): Promise<void> {
    if (this.conversationActive) return;
    this.startCancelled = false;
    this.callbacks.onStatus("connecting");
    try {
      await Promise.all([this.ensureSocket(sessionId), this.ensureMicrophone()]);
      await this.audioContext?.resume();
      this.transcript = "";
      this.conversationActive = true;
      this.captureEnabled = true;
      this.callbacks.onTranscript("", false);
      this.callbacks.onStatus("recording");
    } catch (cause) {
      if (this.startCancelled) return;
      const message = cause instanceof Error ? cause.message : "Could not start NESQA voice.";
      this.releaseAudio();
      this.callbacks.onStatus("error");
      this.callbacks.onError(message);
      throw cause;
    }
  }

  stopConversation(): void {
    this.disconnect(false);
  }

  disconnect(clearSession = false): void {
    this.closeRequested = true;
    this.startCancelled = true;
    this.conversationActive = false;
    this.captureEnabled = false;
    this.rejectReady?.(new Error("Voice conversation stopped."));
    if (this.isSocketOpen()) this.send({ type: "session.close", clear_session: clearSession });
    this.socket?.close(1000);
    this.socket = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.releaseAudio();
    this.callbacks.onStatus("idle");
  }

  private isSocketOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private ensureSocket(sessionId: string | null): Promise<void> {
    if (this.isSocketOpen() && this.readyPromise) return this.readyPromise;
    if (this.socket?.readyState === WebSocket.CONNECTING && this.readyPromise) return this.readyPromise;

    const baseUrl = process.env.NEXT_PUBLIC_NESQA_WS_URL?.replace(/\/$/, "") ?? DEFAULT_VOICE_URL;
    const url = new URL(baseUrl);
    if (sessionId) url.searchParams.set("session_id", sessionId);
    else url.searchParams.set("mode", "express");

    this.closeRequested = false;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const socket = new WebSocket(url.toString());
    this.socket = socket;

    socket.addEventListener("message", (message) => this.handleMessage(message));
    socket.addEventListener("error", () => {
      if (this.socket !== socket || this.closeRequested) return;
      const error = new Error("Could not connect to the NESQA voice service at localhost:8000.");
      this.rejectReady?.(error);
      this.callbacks.onStatus("error");
      this.callbacks.onError(error.message, "voice_connection_failed");
    });
    socket.addEventListener("close", () => {
      const isCurrentSocket = this.socket === socket;
      if (isCurrentSocket && !this.closeRequested) {
        this.callbacks.onStatus("error");
        this.callbacks.onError("The NESQA voice connection ended. Tap the microphone to reconnect.");
      }
      if (isCurrentSocket) {
        this.socket = null;
        this.readyPromise = null;
        this.conversationActive = false;
        this.captureEnabled = false;
      }
    });
    return this.readyPromise;
  }

  private async ensureMicrophone(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is not supported in this browser.");
    if (this.audioContext && this.mediaStream && this.workletNode) return;

    this.audioContext = new AudioContext({ latencyHint: "interactive" });
    void this.audioContext.resume();
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    await this.audioContext.audioWorklet.addModule("/nesqa-pcm-capture-worklet.js");
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.audioContext, "nesqa-pcm-capture");
    this.muteNode = this.audioContext.createGain();
    this.muteNode.gain.value = 0;
    this.workletNode.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (!this.conversationActive || !this.captureEnabled || !this.isSocketOpen()) return;
      this.send({ type: "audio.append", audio: pcm16ToBase64(data) });
    };
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.muteNode);
    this.muteNode.connect(this.audioContext.destination);
  }

  private handleMessage(message: MessageEvent<string>): void {
    let event: VoiceEvent;
    try {
      event = JSON.parse(message.data) as VoiceEvent;
    } catch {
      this.callbacks.onError("NESQA sent an unreadable voice event.", "invalid_event");
      return;
    }

    if (event.type === "session.ready" && event.session_id) {
      this.callbacks.onSession(event.session_id, event.stage ?? "collect_items");
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (event.type === "transcript.delta") {
      this.transcript += event.delta ?? "";
      this.callbacks.onTranscript(this.transcript, false);
      return;
    }
    if (event.type === "speech.started") {
      if (this.conversationActive) this.callbacks.onStatus("recording");
      return;
    }
    if (event.type === "speech.stopped") {
      this.captureEnabled = false;
      if (this.conversationActive) this.callbacks.onStatus("processing");
      return;
    }
    if (event.type === "transcript.completed") {
      this.captureEnabled = false;
      this.transcript = event.transcript ?? this.transcript;
      this.callbacks.onTranscript(this.transcript, true);
      if (this.conversationActive) this.callbacks.onStatus("processing");
      return;
    }
    if (event.type === "agent.response" && event.response) {
      const transcript = event.transcript ?? this.transcript;
      this.callbacks.onResponse(event.response, transcript);
      this.callbacks.onTranscript("", true);
      return;
    }
    if (event.type === "audio.start") {
      this.nextPlaybackTime = this.audioContext?.currentTime ?? 0;
      this.callbacks.onStatus("speaking");
      return;
    }
    if (event.type === "audio.delta" && event.audio) {
      this.enqueueAudio(event.audio);
      return;
    }
    if (event.type === "audio.done") {
      const remaining = Math.max(0, this.nextPlaybackTime - (this.audioContext?.currentTime ?? 0));
      if (this.playbackTimer !== null) window.clearTimeout(this.playbackTimer);
      this.playbackTimer = window.setTimeout(() => {
        this.callbacks.onPlaybackComplete?.();
        if (!this.conversationActive) return;
        this.transcript = "";
        this.captureEnabled = true;
        this.callbacks.onTranscript("", false);
        this.callbacks.onStatus("recording");
      }, remaining * 1000);
      return;
    }
    if (event.type === "error") {
      const error = new Error(event.message ?? "NESQA voice encountered an error.");
      this.rejectReady?.(error);
      this.rejectReady = null;
      this.resolveReady = null;
      this.callbacks.onError(error.message, event.code);
      if (this.conversationActive && ["empty_transcript", "transcription_failed"].includes(event.code ?? "")) {
        this.callbacks.onStatus("error");
        this.captureEnabled = true;
        window.setTimeout(() => {
          if (this.conversationActive) this.callbacks.onStatus("recording");
        }, 1200);
        return;
      }
      this.disconnect(false);
      this.callbacks.onStatus("error");
    }
  }

  private enqueueAudio(encoded: string): void {
    if (!this.audioContext) return;
    const pcm = base64ToPcm16(encoded);
    const buffer = this.audioContext.createBuffer(1, pcm.length, VOICE_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 0x8000;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    const startAt = Math.max(this.audioContext.currentTime, this.nextPlaybackTime);
    source.start(startAt);
    this.nextPlaybackTime = startAt + buffer.duration;
  }

  private send(payload: Record<string, unknown>): void {
    if (this.isSocketOpen()) this.socket?.send(JSON.stringify(payload));
  }

  private releaseAudio(): void {
    if (this.playbackTimer !== null) window.clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
    this.sourceNode?.disconnect();
    this.workletNode?.disconnect();
    this.muteNode?.disconnect();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    void this.audioContext?.close();
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.muteNode = null;
    this.nextPlaybackTime = 0;
  }
}
