import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { HandLandmarker } from '@mediapipe/tasks-vision';
import { HandCamera, type FrameResult } from './camera';
import { GestureEngine, type CursorMode, type EngineSettings, type FrameOutput, type ScreenInfo } from './gestures';
import * as cursor from './cursor';

interface Settings extends EngineSettings {
  enabled: boolean;
  alwaysOnTop: boolean;
  compact: boolean;
}

const DEFAULTS: Settings = {
  enabled: true,
  mode: 'absolute',
  sensitivity: 6,
  response: 7,
  deadZone: 0.3,
  scrollSensitivity: 5,
  alwaysOnTop: true,
  compact: false,
};

const STORAGE_KEY = 'wavecursor.settings';

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function loadSettings(): Settings {
  const d = DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...d };
    // Validate every field — stale or hand-edited storage must never crash
    // the gesture engine or leave the UI in a broken state.
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : d.enabled,
      mode: p.mode === 'absolute' || p.mode === 'relative' ? p.mode : d.mode,
      sensitivity: clampNum(p.sensitivity, 1, 10, d.sensitivity),
      response: clampNum(p.response, 1, 10, d.response),
      deadZone: clampNum(p.deadZone, 0, 1, d.deadZone),
      scrollSensitivity: clampNum(p.scrollSensitivity, 1, 10, d.scrollSensitivity),
      alwaysOnTop: typeof p.alwaysOnTop === 'boolean' ? p.alwaysOnTop : d.alwaysOnTop,
      compact: typeof p.compact === 'boolean' ? p.compact : d.compact,
    };
  } catch {
    return { ...d };
  }
}

const MODE_LABEL: Record<CursorMode, { text: string; color: string }> = {
  move: { text: 'MOVE', color: '#38d3b9' },
  click: { text: 'CLICK', color: '#e3b35c' },
  rightclick: { text: 'RIGHT CLICK', color: '#e18498' },
  drag: { text: 'DRAG', color: '#a292f2' },
  scroll: { text: 'SCROLL', color: '#5ba9e2' },
  none: { text: 'READY', color: '#5e6c80' },
};

type Status = 'idle' | 'loading' | 'running' | 'error';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<HandCamera | null>(null);
  const engineRef = useRef<GestureEngine | null>(null);
  const settingsRef = useRef<Settings>(loadSettings());
  const screenRef = useRef<ScreenInfo | null>(null);

  const [settings, setSettings] = useState<Settings>(settingsRef.current);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<CursorMode>('none');
  const [handDetected, setHandDetected] = useState(false);
  const [fps, setFps] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [screenSize, setScreenSize] = useState('');
  const [flashKey, setFlashKey] = useState(0);
  const [statusMsg, setStatusMsg] = useState('Starting…');
  const [restartKey, setRestartKey] = useState(0);

  const fpsRef = useRef({ frames: 0, last: performance.now() });
  const cursorRef = useRef({ x: 0, y: 0 });

  const updateSettings = (patch: Partial<Settings>) => {
    // Fresh smoothing/last-tip state when the mapping changes.
    if (patch.mode !== undefined) {
      if (engineRef.current?.isDragging) cursor.leftUp();
      engineRef.current?.reset();
    }
    // Compute the next settings up front and keep side-effects out of the
    // state updater (StrictMode double-invokes updaters, which would fire
    // the window RPCs twice per toggle).
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (patch.alwaysOnTop !== undefined) cursor.setAlwaysOnTop(next.alwaysOnTop);
    if (patch.compact !== undefined) {
      cursor.setWindowSize(next.compact ? 560 : 1180, next.compact ? 640 : 780);
    }
    setSettings(next);
  };

  // ── drawing ─────────────────────────────────────────────────────────────
  const drawFrame = useCallback((landmarks: FrameResult['landmarks'], pinchProgress = 0) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Mirrored video + landmarks.
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    if (landmarks) {
      ctx.strokeStyle = 'rgba(45,212,191,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const c of HandLandmarker.HAND_CONNECTIONS) {
        ctx.moveTo(landmarks[c.start].x * W, landmarks[c.start].y * H);
        ctx.lineTo(landmarks[c.end].x * W, landmarks[c.end].y * H);
      }
      ctx.stroke();

      landmarks.forEach((lm, i) => {
        const color =
          i === 8 ? '#fbbf24' : i === 4 ? '#fb7185' : i === 0 ? '#38bdf8' : '#e2e8f0';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lm.x * W, lm.y * H, i === 8 || i === 4 ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      });

      // Pinch progress ring around the index fingertip — fills as the pinch
      // approaches the click threshold, so the user can see when it engages.
      if (pinchProgress > 0.02) {
        const tip = landmarks[8];
        const cx = tip.x * W;
        const cy = tip.y * H;
        const r = 15 + pinchProgress * 9;
        ctx.strokeStyle = pinchProgress > 0.7 ? '#fbbf24' : '#2dd4bf';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.45 + 0.55 * pinchProgress;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pinchProgress * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }, []);

  // ── frame pipeline ───────────────────────────────────────────────────────
  const handleFrame = useCallback(
    (r: FrameResult) => {
      const f = fpsRef.current;
      f.frames++;
      const nowMs = performance.now();
      if (nowMs - f.last >= 1000) {
        setFps(Math.round((f.frames * 1000) / (nowMs - f.last)));
        f.frames = 0;
        f.last = nowMs;
      }

      const engine = engineRef.current;
      if (!engine) return;
      const s = settingsRef.current;

      if (!s.enabled) {
        // Never leave the mouse button held when tracking is paused
        // mid-drag — release it before the engine forgets the drag.
        if (engine.isDragging) cursor.leftUp();
        engine.reset();
        const lm = r.landmarks ?? null;
        drawFrame(lm, 0);
        setHandDetected(!!lm);
        setMode('none');
        return;
      }

      const out: FrameOutput = {
        mode: 'none',
        detected: false,
        pinch: false,
        targetX: 0,
        targetY: 0,
        scroll: 0,
        leftDown: false,
        leftUp: false,
        leftClick: false,
        leftDoubleClick: false,
        rightClick: false,
        pinchProgress: 0,
      };
      engine.process(r.landmarks, r.timestamp, out);

      if (out.leftDown) cursor.leftDown();
      if (out.leftUp) cursor.leftUp();
      if (out.leftClick) {
        cursor.leftClick();
        setFlashKey((k) => k + 1);
      }
      if (out.leftDoubleClick) {
        cursor.leftDoubleClick();
        setFlashKey((k) => k + 1);
      }
      if (out.rightClick) {
        cursor.rightClick();
        setFlashKey((k) => k + 1);
      }
      if (out.scroll !== 0) cursor.scroll(out.scroll);

      // Relative mode drives the cursor directly (the 60fps interpolator
      // below only runs for absolute mode). Drags are absolute in both modes.
      if (settingsRef.current.mode === 'relative') {
        const c = cursorRef.current;
        if (Math.abs(out.targetX - c.x) > 1.5 || Math.abs(out.targetY - c.y) > 1.5) {
          c.x = out.targetX;
          c.y = out.targetY;
          cursor.moveCursor(out.targetX, out.targetY);
        }
      }

      drawFrame(r.landmarks ?? null, out.pinchProgress);
      setHandDetected(out.detected);
      setMode((prev) => (prev === out.mode ? prev : out.mode));
    },
    [drawFrame],
  );

  // ── lifecycle ───────────────────────────────────────────────────────────
  const retry = useCallback(() => {
    // Tear down the failed instance and let the init effect re-run.
    cameraRef.current?.stop();
    cameraRef.current = null;
    engineRef.current?.reset();
    engineRef.current = null;
    setStatus('idle');
    setError('');
    setStatusMsg('Restarting…');
    setRestartKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const screen = await cursor.loadScreen();
        if (cancelled) return;
        screenRef.current = screen;
        setScreenSize(`${screen.Width} × ${screen.Height}`);
        engineRef.current = new GestureEngine(screen, settingsRef.current);
        // Seed the engine at the real cursor position so the first frame
        // does not jump the mouse to the corner of the screen.
        try {
          const pos = await cursor.getCursorPosition();
          engineRef.current.seed(pos.x, pos.y);
        } catch {
          /* position unavailable — engine will self-seed on first frame */
        }

        const cam = new HandCamera(videoRef.current!);
        cameraRef.current = cam;
        cam.onFrame = handleFrame;

        // Apply the persisted window geometry before the first paint so a
        // compact-mode session doesn't flash full-size first.
        if (settingsRef.current.compact) {
          cursor.setWindowSize(560, 640);
        }

        await cam.start((step) => setStatusMsg(step));
        if (cancelled) {
          cam.stop();
          return;
        }
        setStatus('running');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    init();
    return () => {
      cancelled = true;
      // Release any held drag before tearing the engine down.
      if (engineRef.current?.isDragging) cursor.leftUp();
      cameraRef.current?.stop();
      cameraRef.current = null;
      engineRef.current?.reset();
      engineRef.current = null;
    };
  }, [handleFrame, restartKey]);

  // ── 60fps cursor interpolator ────────────────────────────────────────────
  // Hand detection runs at whatever rate MediaPipe can manage; this loop runs
  // at the display refresh rate and eases the real cursor toward the latest
  // detection target. That decouples cursor smoothness from detection speed,
  // and a short velocity glide keeps motion fluid even when a detection frame
  // is late (e.g. right after switching apps in the background).
  useEffect(() => {
    let raf = 0;
    let sentX = 0;
    let sentY = 0;
    let sentInited = false;
    let prevHasTarget = false;
    let lastTargetX = 0;
    let lastTargetY = 0;
    let lastTargetAt = 0;
    let velX = 0;
    let velY = 0;
    let lastFrameAt = performance.now();
    let lastPosPush = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const engine = engineRef.current;
      if (!engine || settingsRef.current.mode !== 'absolute' || !settingsRef.current.enabled) return;

      // Snap whenever a target first appears (startup, mode switch).
      if (engine.hasTarget && !prevHasTarget && !sentInited) {
        sentX = engine.targetX;
        sentY = engine.targetY;
        sentInited = true;
      }
      prevHasTarget = engine.hasTarget;
      if (!engine.hasTarget) return;

      const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;

      const tx = engine.targetX;
      const ty = engine.targetY;
      if (tx !== lastTargetX || ty !== lastTargetY) {
        const dtT = Math.max(1 / 60, (now - lastTargetAt) / 1000);
        velX = (tx - lastTargetX) / dtT;
        velY = (ty - lastTargetY) / dtT;
        lastTargetX = tx;
        lastTargetY = ty;
        lastTargetAt = now;
      }

      const s = settingsRef.current;
      const ease = 1 - Math.exp(-(10 + ((s.response - 1) / 9) * 34) * dt);

      // Glide along the last velocity while detection is briefly stalled.
      const stall = now - lastTargetAt;
      if (stall > 120 && (velX !== 0 || velY !== 0)) {
        const glide = Math.min(1, (stall - 120) / 400) * 0.3;
        sentX += velX * dt * glide;
        sentY += velY * dt * glide;
      }

      sentX += (tx - sentX) * ease;
      sentY += (ty - sentY) * ease;

      cursor.moveCursor(sentX, sentY);

      if (now - lastPosPush > 100) {
        lastPosPush = now;
        setCursorPos({ x: Math.round(sentX), y: Math.round(sentY) });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // If the window loses focus mid-drag (user switches apps, the always-on-top
  // panel gets covered), release the mouse button — otherwise the button
  // would stay held with no hand to release it.
  useEffect(() => {
    const onBlur = () => {
      const engine = engineRef.current;
      if (engine?.isDragging) {
        cursor.leftUp();
        engine.reset();
      }
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  // Space toggles tracking (unless a slider has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
      e.preventDefault();
      updateSettings({ enabled: !settingsRef.current.enabled });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = status === 'loading' || status === 'idle';

  return (
    <div className={`app ${settings.compact ? 'compact' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <div>
            <h1>WaveCursor</h1>
            <p>camera cursor control</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span
            role="status"
            className={`status-pill ${status === 'running' ? 'ok' : status === 'error' ? 'bad' : 'busy'}`}
          >
            <i />
            {status === 'running' ? 'LIVE' : status === 'error' ? 'ERROR' : 'STARTING'}
          </span>
          <button
            className={`icon-btn ${settings.compact ? 'active' : ''}`}
            title={settings.compact ? 'Exit compact mode' : 'Compact mode'}
            aria-label={settings.compact ? 'Exit compact mode' : 'Compact mode'}
            aria-pressed={settings.compact}
            onClick={() => updateSettings({ compact: !settings.compact })}
          >
            ▣
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="camera-card">
          <div className={`camera-wrap ${status === 'running' ? 'live' : ''}`}>
            <video ref={videoRef} className="camera-video" playsInline muted />
            <canvas ref={canvasRef} width={640} height={480} className="camera-canvas" />
            <div key={flashKey} className={`click-flash ${flashKey > 0 ? 'flash' : ''}`} />
            <div className="viewfinder-hud">
              <span
                className={`mode-badge ${!settings.enabled ? 'paused' : ''}`}
                style={
                  settings.enabled
                    ? { color: MODE_LABEL[mode].color, borderColor: `${MODE_LABEL[mode].color}55` }
                    : undefined
                }
              >
                <i />
                {settings.enabled ? MODE_LABEL[mode].text : 'PAUSED'}
              </span>
              <span className="cam-tag">WAVECURSOR · CAM 01</span>
            </div>
            {loading && (
              <div className="camera-loading">
                <div className="spinner" />
                <p>{statusMsg || 'Starting camera…'}</p>
              </div>
            )}
            {status === 'error' && (
              <div className="camera-loading error">
                <p>⚠️ Could not start the camera</p>
                <p className="err-detail">{error}</p>
                <p className="err-detail">Make sure a webcam is connected and access is allowed.</p>
                <button className="retry-btn" onClick={retry}>
                  Try again
                </button>
              </div>
            )}
          </div>
          <div className="chips">
            <div className={`chip ${handDetected && settings.enabled ? 'ok' : ''}`}>
              <span className="dot" />{' '}
              {settings.enabled ? (handDetected ? 'HAND DETECTED' : 'HAND NOT FOUND') : 'PAUSED'}
            </div>
            <div className="chip">
              <span
                className="dot"
                style={{ background: settings.enabled ? MODE_LABEL[mode].color : 'var(--text-3)' }}
              />{' '}
              {settings.enabled ? MODE_LABEL[mode].text : 'PAUSED'}
            </div>
            <div className="chip">{status === 'running' ? `${fps} FPS` : '-- FPS'}</div>
            <div className="chip">
              {cursorPos.x}, {cursorPos.y}
            </div>
          </div>
        </section>

        {!settings.compact && (
          <aside className="panel">
            <div className="panel-section">
              <div className="panel-title">Tracking</div>
              <button
                className={`master-toggle ${settings.enabled ? 'on' : ''}`}
                role="switch"
                aria-checked={settings.enabled}
                onClick={() => updateSettings({ enabled: !settings.enabled })}
              >
                <span className="toggle-track">
                  <span className="toggle-knob" />
                </span>
                {settings.enabled ? 'CONTROL ON' : 'CONTROL OFF'}
              </button>
              <p className="hint">
                {settings.enabled
                  ? 'Hand gestures drive the mouse. Press Space to pause.'
                  : 'Paused — camera still runs, gestures ignored. Press Space to resume.'}
              </p>

              <div className="segmented-label">
                <span>Tracking mode</span>
                <span className="hint">Absolute: finger = cursor · Relative: move to steer</span>
              </div>
              <div className="segmented" role="group" aria-label="Tracking mode">
                <button
                  className={settings.mode === 'absolute' ? 'active' : ''}
                  aria-pressed={settings.mode === 'absolute'}
                  onClick={() => updateSettings({ mode: 'absolute' })}
                >
                  Absolute
                </button>
                <button
                  className={settings.mode === 'relative' ? 'active' : ''}
                  aria-pressed={settings.mode === 'relative'}
                  onClick={() => updateSettings({ mode: 'relative' })}
                >
                  Relative
                </button>
              </div>
            </div>

            <div className="panel-section">
              <div className="panel-title">Feel</div>
              <Slider
                label="Sensitivity"
                value={settings.sensitivity}
                min={1}
                max={10}
                onChange={(v) => updateSettings({ sensitivity: v })}
                hint={
                  settings.mode === 'absolute'
                    ? 'Zoom — how much hand movement covers the screen'
                    : 'Speed — how fast fingertip motion moves the cursor'
                }
              />
              <Slider
                label="Response"
                value={settings.response}
                min={1}
                max={10}
                onChange={(v) => updateSettings({ response: v })}
                hint="Cursor smoothing (higher = snappier)"
              />
              {settings.mode === 'relative' && (
                <Slider
                  label="Dead zone"
                  value={Math.round(settings.deadZone * 100)}
                  min={1}
                  max={40}
                  step={1}
                  onChange={(v) => updateSettings({ deadZone: v / 100 })}
                  hint="Ignore small involuntary hand movements"
                />
              )}
              <Slider
                label="Scroll speed"
                value={settings.scrollSensitivity}
                min={1}
                max={10}
                onChange={(v) => updateSettings({ scrollSensitivity: v })}
                hint="How fast the two-finger gesture scrolls"
              />
            </div>

            <div className="panel-section">
              <div className="panel-title">Window</div>
              <Toggle
                label="Always on top"
                value={settings.alwaysOnTop}
                onChange={(v) => updateSettings({ alwaysOnTop: v })}
                hint="Keep the window visible so tracking never slows — this is the background mode"
              />
              <Toggle
                label="Compact mode"
                value={settings.compact}
                onChange={(v) => updateSettings({ compact: v })}
                hint="Shrink to a small floating camera window"
              />
            </div>

            <div className="panel-section">
              <div className="panel-title">Gestures</div>
              <ul className="gesture-list">
                <li><span>✋ open hand</span><b>Move cursor</b></li>
                <li><span>👌 pinch · quick</span><b>Left click</b></li>
                <li><span>👌 pinch · twice</span><b>Double click</b></li>
                <li><span>🤏 pinch · move hand</span><b>Drag &amp; drop</b></li>
                <li><span>🫰 thumb + middle</span><b>Right click</b></li>
                <li><span>🖖 two fingers up</span><b>Scroll</b></li>
              </ul>
            </div>

            <div className="panel-section screen-info">
              Screen: <b>{screenSize || '…'}</b>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

function BrandMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M10 24c3.4 0 3.4-5.4 6.8-5.4s3.4 5.4 6.8 5.4 3.4-5.4 6.8-5.4 3.4 5.4 6.8 5.4"
        stroke="url(#wcWave)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="40.2" cy="24" r="3.6" fill="#ffd08a" />
      <defs>
        <linearGradient id="wcWave" x1="10" y1="18.6" x2="37.2" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#63e7d0" />
          <stop offset="1" stopColor="#2aa892" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <div className="slider-head">
        <span>{props.label}</span>
        <span className="slider-value">{props.value}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        style={{ '--fill': `${((props.value - props.min) / (props.max - props.min)) * 100}%` } as CSSProperties}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <div className="hint">{props.hint}</div>
    </label>
  );
}

function Toggle(props: { label: string; value: boolean; hint: string; onChange: (v: boolean) => void }) {
  return (
    <button
      className="toggle-row"
      role="switch"
      aria-checked={props.value}
      onClick={() => props.onChange(!props.value)}
    >
      <div>
        <div className="toggle-label">{props.label}</div>
        <div className="hint">{props.hint}</div>
      </div>
      <span className={`toggle-track small ${props.value ? 'on' : ''}`}>
        <span className="toggle-knob" />
      </span>
    </button>
  );
}
