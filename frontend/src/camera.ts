import { FilesetResolver, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface FrameResult {
  landmarks: NormalizedLandmark[] | null;
  timestamp: number;
}

/**
 * Owns the webcam stream and the MediaPipe HandLandmarker.
 * Detection runs on a requestAnimationFrame loop with a watchdog interval
 * that keeps processing frames even if the webview throttles rAF.
 */
export class HandCamera {
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private watchdogId = 0;
  private lastVideoTime = -1;
  private lastTick = 0;
  private running = false;

  onFrame: ((r: FrameResult) => void) | null = null;

  constructor(private video: HTMLVideoElement) {}

  get started(): boolean {
    return this.running;
  }

  async start(onProgress?: (step: string) => void): Promise<void> {
    if (this.running) return;
    this.running = true;

    onProgress?.('Loading hand-tracking model…');
    const vision = await FilesetResolver.forVisionTasks('/wasm');

    const baseOptions = {
      modelAssetPath: '/models/hand_landmarker.task',
    };

    // Prefer the GPU delegate, fall back to CPU on machines without WebGL2.
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    }

    onProgress?.('Opening camera…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user',
      },
    });

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 2) resolve();
      else this.video.addEventListener('loadeddata', () => resolve(), { once: true });
    });

    this.lastTick = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.lastTick = now;
      this.processFrame(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);

    // If rAF stalls (window briefly occluded/minimised), keep sampling.
    this.watchdogId = window.setInterval(() => {
      if (this.running && performance.now() - this.lastTick > 250) {
        this.processFrame(performance.now());
      }
    }, 80);
  }

  private processFrame(now: number): void {
    if (!this.landmarker || !this.onFrame) return;
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    try {
      const result = this.landmarker.detectForVideo(v, now);
      const landmarks = result.landmarks && result.landmarks.length > 0 ? result.landmarks[0] : null;
      this.onFrame({ landmarks, timestamp: now });
    } catch {
      // Ignore transient detection errors; the next frame will retry.
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    window.clearInterval(this.watchdogId);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video.srcObject) {
      this.video.srcObject = null;
    }
    this.landmarker?.close();
    this.landmarker = null;
  }
}
