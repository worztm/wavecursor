import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Gesture vocabulary
 * ─────────────────────────────────────────────────────────────────
 *  MOVE        open hand (index finger out) → cursor follows the
 *              index fingertip.
 *  CLICK       pinch thumb + index, then release (hold as long as
 *              you like — just don't move the hand).
 *  DOUBLE      two quick pinch-and-release cycles.
 *  DRAG        pinch thumb + index AND move the hand → the grabbed
 *              item follows your hand exactly. Release to drop.
 *  RIGHT       pinch thumb + middle (index raised), release.
 *  SCROLL      index + middle raised together → moving the hand
 *              up/down scrolls the wheel.
 *
 * Accuracy notes:
 *  - Pinch distances are measured in 3D (x, y, depth) so a tilted
 *    hand still registers correctly.
 *  - Pinch thresholds auto-calibrate to the resting distance of
 *    your open hand, so hand size and camera distance don't matter.
 *  - Clicks require the hand to have been open recently, which
 *    rejects resting fists and stray finger curls.
 */

export type CursorMode = 'move' | 'click' | 'rightclick' | 'drag' | 'scroll' | 'none';

/**
 * absolute — fingertip position in the camera frame maps 1:1 to the screen
 *             (mirror-style: move your hand right → cursor right).
 * relative — fingertip *movement* steers the cursor (hold still to stop).
 */
export type TrackingMode = 'absolute' | 'relative';

export interface ScreenInfo {
  X: number;
  Y: number;
  Width: number;
  Height: number;
  FlippedY: boolean;
}

export interface EngineSettings {
  mode: TrackingMode; // how the fingertip drives the cursor
  sensitivity: number; // 1..10 — absolute: zoom / relative: speed
  response: number;    // 1..10 — smoothing (higher = snappier)
  deadZone: number;    // 0..1  — relative only: ignored small movements
  scrollSensitivity: number; // 1..10
}

export interface FrameOutput {
  mode: CursorMode;
  detected: boolean;
  pinch: boolean;
  targetX: number;
  targetY: number;
  scroll: number;
  leftDown: boolean;
  leftUp: boolean;
  leftClick: boolean;
  leftDoubleClick: boolean;
  rightClick: boolean;
  /** 0..1 — how close the thumb+index pinch is to registering (UI feedback). */
  pinchProgress: number;
}

// MediaPipe hand landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;

// Timing / hysteresis
const MIN_HOLD_MS = 90; // pinches shorter than this are ignored (finger flicks)
const CLICK_COOLDOWN_MS = 240; // debounce between click actions
const DOUBLE_CLICK_MS = 320; // two pinches closer than this = double click
const DRAG_START_MS = 140; // movement only starts a drag after this delay
const DRAG_START_DIST = 0.35; // …and only once the hand moved this far (× palm)
const TWO_FINGER_MIN = 0.55; // min finger/palm ratio to count as "raised"
const RIGHT_INDEX_UP_MIN = 0.4; // index must be raised for a right-click pinch
const OPEN_HISTORY = 4; // frames a hand counts as "recently open"

// Adaptive-threshold clamps (fractions of the open-hand baseline)
const PINCH_IN_MIN = 0.16;
const PINCH_IN_MAX = 0.42;
const PINCH_OUT_MIN = 0.3;
const PINCH_OUT_MAX = 0.58;

type EngineState = 'idle' | 'pinching' | 'dragging' | 'right' | 'scroll';

interface Pt {
  x: number;
  y: number;
  z: number;
}

function dist3(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function scale01(v: number, from: number, to: number): number {
  return from + ((v - 1) / 9) * (to - from);
}

export class GestureEngine {
  private state: EngineState = 'idle';
  private stateSince = 0;
  private cooldownUntil = 0;
  private leftHeld = false;
  private smoothedX = 0;
  private smoothedY = 0;
  private initialized = false;
  private lastWrist: Pt | null = null;
  private scrollAccum = 0;
  private lastClickAt = 0;
  private pinchHeld = false;
  private rightPinchHeld = false;
  private lastTip: Pt | null = null;

  // Adaptive calibration
  private palm = 0; // smoothed palm size
  private openBaselineIndex = 0.8; // resting thumb→index distance (× palm)
  private openBaselineMiddle = 0.8; // resting thumb→middle distance (× palm)
  private pinchIn = 0.3;
  private pinchOut = 0.45;
  private rightPinchIn = 0.3;
  private rightPinchOut = 0.45;
  private openHistory: boolean[] = [];

  // Drag anchors
  private grabAnchor: Pt | null = null;
  private dragAnchor: Pt | null = null;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor(
    private screen: ScreenInfo,
    private settings: EngineSettings,
  ) {}

  get isDragging(): boolean {
    return this.leftHeld;
  }

  /** Whether a smoothed cursor target exists yet. */
  get hasTarget(): boolean {
    return this.initialized;
  }

  /** Latest smoothed cursor target (absolute desktop position). */
  get targetX(): number {
    return this.smoothedX;
  }

  get targetY(): number {
    return this.smoothedY;
  }

  /** Seeds the cursor at its real current position (avoids startup jumps). */
  seed(x: number, y: number): void {
    this.smoothedX = x;
    this.smoothedY = y;
    this.initialized = true;
  }

  /** Releases any held buttons (call when the app is paused or closed). */
  reset(): void {
    if (this.leftHeld) {
      this.leftHeld = false;
    }
    this.state = 'idle';
    this.stateSince = 0;
    this.cooldownUntil = 0;
    this.lastClickAt = 0;
    this.lastWrist = null;
    this.scrollAccum = 0;
    this.initialized = false;
    this.pinchHeld = false;
    this.rightPinchHeld = false;
    this.lastTip = null;
    this.grabAnchor = null;
    this.dragAnchor = null;
    this.openHistory = [];
  }

  /**
   * Runs one frame of gesture logic. `landmarks` are the raw MediaPipe
   * coordinates; internally the X axis is mirrored so the math matches the
   * mirrored video preview the user sees.
   */
  process(landmarks: NormalizedLandmark[] | null, now: number, out: FrameOutput): void {
    out.mode = 'none';
    out.detected = false;
    out.pinch = false;
    out.scroll = 0;
    out.leftDown = false;
    out.leftUp = false;
    out.leftClick = false;
    out.leftDoubleClick = false;
    out.rightClick = false;
    out.pinchProgress = 0;
    out.targetX = this.smoothedX;
    out.targetY = this.smoothedY;

    if (!landmarks) {
      // Hand lost: abort any in-flight action safely.
      if (this.state === 'dragging' && this.leftHeld) {
        out.leftUp = true;
        this.leftHeld = false;
      }
      this.state = 'idle';
      this.lastWrist = null;
      this.scrollAccum = 0;
      this.pinchHeld = false;
      this.rightPinchHeld = false;
      this.lastTip = null;
      this.grabAnchor = null;
      this.dragAnchor = null;
      this.openHistory = [];
      this.palm = 0; // re-calibrate when the hand reappears
      return;
    }

    out.detected = true;

    // Mirror X so gesture math matches the mirrored preview.
    const P = (i: number): Pt => ({ x: 1 - landmarks[i].x, y: landmarks[i].y, z: landmarks[i].z ?? 0 });

    // Smoothed palm size (average of two wrist→MCP spans) — scale invariant
    // across hand size and camera distance.
    const palmRaw = (dist3(P(WRIST), P(INDEX_MCP)) + dist3(P(WRIST), P(MIDDLE_MCP))) / 2;
    if (this.palm === 0) this.palm = palmRaw;
    else this.palm += (palmRaw - this.palm) * 0.35;
    const palm = this.palm || 1e-6;

    // 3D pinch distances (x, y + depth) so tilted hands still register.
    const pinchIndexRaw = dist3(P(THUMB_TIP), P(INDEX_TIP)) / palm;
    const pinchMiddleRaw = dist3(P(THUMB_TIP), P(MIDDLE_TIP)) / palm;

    // ── Adaptive calibration ──────────────────────────────────────────────
    // While the hand rests open, nudge the baseline toward the observed
    // resting distances. Thresholds are fractions of that baseline, so they
    // automatically fit each user's hand size and camera distance.
    if (this.state === 'idle') {
      if (pinchIndexRaw > this.pinchOut) {
        this.openBaselineIndex += (pinchIndexRaw - this.openBaselineIndex) * 0.05;
      }
      if (pinchMiddleRaw > this.rightPinchOut) {
        this.openBaselineMiddle += (pinchMiddleRaw - this.openBaselineMiddle) * 0.05;
      }
    }
    this.pinchIn = clamp(this.openBaselineIndex * 0.45, PINCH_IN_MIN, PINCH_IN_MAX);
    this.pinchOut = clamp(this.openBaselineIndex * 0.68, PINCH_OUT_MIN, PINCH_OUT_MAX);
    this.rightPinchIn = clamp(this.openBaselineMiddle * 0.45, PINCH_IN_MIN, PINCH_IN_MAX);
    this.rightPinchOut = clamp(this.openBaselineMiddle * 0.68, PINCH_OUT_MIN, PINCH_OUT_MAX);

    // Hysteresis: engage below the "in" threshold, disengage above "out".
    if (pinchIndexRaw < this.pinchIn) this.pinchHeld = true;
    else if (pinchIndexRaw > this.pinchOut) this.pinchHeld = false;
    const pinchActive = this.pinchHeld;

    // Right click: thumb→middle pinch with the index finger raised.
    const indexRaised =
      dist3(P(INDEX_TIP), P(INDEX_PIP)) / palm > RIGHT_INDEX_UP_MIN && P(INDEX_TIP).y < P(INDEX_PIP).y;
    const rightPinch = pinchMiddleRaw < this.rightPinchIn && indexRaised;
    if (rightPinch) this.rightPinchHeld = true;
    else if (pinchMiddleRaw > this.rightPinchOut) this.rightPinchHeld = false;
    // The index finger must stay raised for the whole gesture — lowering it
    // mid-pinch cancels the right-click instead of letting it fire on release.
    const rightPinchActive = !pinchActive && this.rightPinchHeld && indexRaised;

    const indexUp = dist3(P(INDEX_TIP), P(INDEX_PIP)) / palm > TWO_FINGER_MIN && P(INDEX_TIP).y < P(INDEX_PIP).y;
    const middleUp = dist3(P(MIDDLE_TIP), P(MIDDLE_PIP)) / palm > TWO_FINGER_MIN && P(MIDDLE_TIP).y < P(MIDDLE_PIP).y;
    const handOpen = pinchIndexRaw > this.pinchOut && pinchMiddleRaw > this.rightPinchOut;

    // The hand must have been open in the last few frames for a pinch to
    // start — resting fists and stray finger curls never click.
    this.openHistory.push(handOpen);
    if (this.openHistory.length > OPEN_HISTORY) this.openHistory.shift();
    const openRecent = this.openHistory.some(Boolean);

    const twoFingerUp = handOpen && indexUp && middleUp && pinchIndexRaw > 0.5;

    const wrist = P(WRIST);
    const canFireClick = now > this.cooldownUntil;
    const grab = (): Pt => midpoint(P(THUMB_TIP), P(INDEX_TIP));

    switch (this.state) {
      case 'idle':
        if (pinchActive && openRecent) {
          this.state = 'pinching';
          this.stateSince = now;
          this.grabAnchor = grab();
          out.pinch = true;
        } else if (rightPinchActive && openRecent) {
          this.state = 'right';
          this.stateSince = now;
          this.grabAnchor = grab();
        } else if (twoFingerUp) {
          this.state = 'scroll';
          this.stateSince = now;
          this.scrollAccum = 0;
          this.lastWrist = wrist;
        }
        break;

      case 'pinching':
        out.pinch = true;
        if (!pinchActive) {
          // Released: a still pinch is a click, a moving one became a drag.
          const held = now - this.stateSince;
          if (held >= MIN_HOLD_MS) {
            if (this.lastClickAt !== 0 && now - this.lastClickAt < DOUBLE_CLICK_MS) {
              out.leftDoubleClick = true;
              this.lastClickAt = 0;
            } else if (canFireClick) {
              out.leftClick = true;
              this.lastClickAt = now;
              this.cooldownUntil = now + CLICK_COOLDOWN_MS;
            }
          }
          this.state = 'idle';
        } else if (this.grabAnchor && now - this.stateSince > DRAG_START_MS) {
          // Movement while pinching → drag (the item follows your hand).
          const disp = dist3(grab(), this.grabAnchor) / palm;
          if (disp > DRAG_START_DIST) {
            this.state = 'dragging';
            out.leftDown = true;
            this.leftHeld = true;
            this.dragAnchor = grab();
            this.dragStartX = this.smoothedX;
            this.dragStartY = this.smoothedY;
          }
        }
        break;

      case 'dragging':
        out.pinch = true;
        if (!pinchActive) {
          out.leftUp = true;
          this.leftHeld = false;
          this.cooldownUntil = now + CLICK_COOLDOWN_MS;
          this.state = 'idle';
        } else if (this.dragAnchor) {
          // Anchor-follow drag: cursor = drag start + grab displacement.
          // Absolute tracking — no accumulation drift, feels 1:1 with the hand.
          const g = grab();
          const zoom = scale01(this.settings.sensitivity, 0.6, 1.4);
          const dx = (g.x - this.dragAnchor.x) * this.screen.Width * zoom;
          const dy = (g.y - this.dragAnchor.y) * this.screen.Height * zoom;
          const tx = clamp(this.dragStartX + dx, this.screen.X, this.screen.X + this.screen.Width);
          const ty = clamp(
            this.dragStartY + (this.screen.FlippedY ? -dy : dy),
            this.screen.Y,
            this.screen.Y + this.screen.Height,
          );
          this.smoothedX = tx;
          this.smoothedY = ty;
          out.targetX = tx;
          out.targetY = ty;
        }
        break;

      case 'right':
        if (!rightPinchActive) {
          // A right pinch that stays still = right click; moving cancels it.
          const held = now - this.stateSince;
          const moved = this.grabAnchor ? dist3(grab(), this.grabAnchor) / palm > DRAG_START_DIST : false;
          if (held >= MIN_HOLD_MS && !moved && canFireClick) {
            out.rightClick = true;
            this.cooldownUntil = now + CLICK_COOLDOWN_MS;
          }
          this.state = 'idle';
        }
        break;

      case 'scroll':
        if (!twoFingerUp) {
          this.state = 'idle';
          this.lastWrist = null;
          this.scrollAccum = 0;
        } else {
          if (this.lastWrist) {
            // Moving the hand up (frame y decreases) scrolls up.
            this.scrollAccum += this.lastWrist.y - wrist.y;
          }
          this.lastWrist = wrist;
          const factor = scale01(this.settings.scrollSensitivity, 2, 14);
          const total = this.scrollAccum * factor;
          const lines = clamp(Math.round(total), -8, 8);
          if (lines !== 0) {
            out.scroll = lines;
            this.scrollAccum -= lines / factor;
          }
        }
        break;
    }

    out.pinch = this.state === 'pinching' || this.state === 'dragging';

    // Visual feedback: how close the thumb+index pinch is to registering.
    out.pinchProgress = clamp(1 - pinchIndexRaw / this.pinchOut, 0, 1);

    // Cursor target only updates in free-move mode so pinching/clicking does
    // not nudge the cursor.
    if (this.state === 'idle' && handOpen) {
      const tip = P(INDEX_TIP);
      const centerX = this.screen.X + this.screen.Width / 2;
      const centerY = this.screen.Y + this.screen.Height / 2;
      let tx = this.smoothedX;
      let ty = this.smoothedY;

      if (this.settings.mode === 'absolute') {
        // ── Absolute (default) ────────────────────────────────────────────
        // Fingertip position in the frame maps straight onto the desktop.
        // A small inset keeps the cursor reachable at every screen edge.
        // The sensitivity slider becomes a zoom factor around the center.
        const INSET = 0.03;
        const nx = clamp((tip.x - INSET) / (1 - 2 * INSET), 0, 1);
        const ny = clamp((tip.y - INSET) / (1 - 2 * INSET), 0, 1);
        const screenY = this.screen.FlippedY ? 1 - ny : ny;
        const zoom = scale01(this.settings.sensitivity, 0.6, 1.4);
        tx = centerX + (nx - 0.5) * this.screen.Width * zoom;
        ty = centerY + (screenY - 0.5) * this.screen.Height * zoom;
      } else if (this.lastTip) {
        // ── Relative ─────────────────────────────────────────────────────
        const dx = tip.x - this.lastTip.x;
        const dy = tip.y - this.lastTip.y;
        const mag = Math.hypot(dx, dy);
        if (mag >= this.settings.deadZone) {
          const gain = this.screen.Width * scale01(this.settings.sensitivity, 0.9, 2.2);
          tx = this.smoothedX + dx * gain;
          ty = this.smoothedY + (this.screen.FlippedY ? -dy : dy) * gain;
        }
      }
      this.lastTip = tip;

      tx = clamp(tx, this.screen.X, this.screen.X + this.screen.Width);
      ty = clamp(ty, this.screen.Y, this.screen.Y + this.screen.Height);

      // Adaptive smoothing: snappy while moving, calm while holding still.
      const baseAlpha = clamp(scale01(this.settings.response, 0.35, 0.95), 0.25, 0.95);
      const motion = Math.hypot(tx - this.smoothedX, ty - this.smoothedY);
      const speedFactor = Math.min(1, motion / 120);
      const alpha = baseAlpha * (0.45 + 0.55 * speedFactor);
      if (!this.initialized) {
        this.smoothedX = tx;
        this.smoothedY = ty;
        this.initialized = true;
      } else {
        this.smoothedX += (tx - this.smoothedX) * alpha;
        this.smoothedY += (ty - this.smoothedY) * alpha;
      }
    }

    out.targetX = this.smoothedX;
    out.targetY = this.smoothedY;

    if (this.state === 'idle') out.mode = 'move';
    else if (this.state === 'dragging') out.mode = 'drag';
    else if (this.state === 'scroll') out.mode = 'scroll';
    else if (this.state === 'right') out.mode = 'rightclick';
    else if (this.state === 'pinching') out.mode = 'click';
  }
}
