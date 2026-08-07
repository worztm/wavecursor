import { FilesetResolver, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface FrameResult {
  landmarks: NormalizedLandmark[] | null;
  timestamp: number;
}

const VIDEO_OPTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: 'user',
};

/**
 * Owns the webcam stream and the MediaPipe HandLandmarker.
 * Detection runs on a requestAnimationFrame loop with a watchdog interval
 * that keeps processing frames even if the webview throttles rAF.
 *
 * Any failure during start() leaves the instance fully stopped, so the
 * caller can retry — otherwise `running` would stay true and the next
 * start() would bail immediately.
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

    try {
      onProgress?.('Loading hand-tracking model…');
      const vision = await FilesetResolver.forVisionTasks('/wasm');

      const baseOptions = { modelAssetPath: '/models/hand_landmarker.task' };
      const create = (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { ...baseOptions, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

      // Prefer the GPU delegate, fall back to CPU on machines without WebGL2.
      try {
        this.landmarker = await create('GPU');
      } catch {
        this.landmarker = await create('CPU');
      }

      onProgress?.('Opening camera…');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: VIDEO_OPTS,
      });
      this.stream = stream;

      const v = this.video;
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      await v.play();
      await new Promise<void>((resolve) => {
        if (v.readyState >= 2) resolve();
        else v.addEventListener('loadeddata', () => resolve(), { once: true });
      });

      // The instance may have been stopped while we awaited the camera.
      if (!this.running) {
        this.stop();
        return;
      }

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
    } catch (err) {
      // Release the stream and landmarker before rethrowing so a retry
      // starts from a clean slate.
      this.stop();
      throw err;
    }
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
    this.rafId = 0;
    this.watchdogId = 0;
    this.lastVideoTime = -1;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video.srcObject) {
      this.video.srcObject = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }
}