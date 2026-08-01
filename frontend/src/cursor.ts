import { CursorService, type Screen } from '../bindings/wavecursor';

let screen: Screen | null = null;
let lastSentX = 0;
let lastSentY = 0;

/** Loads the virtual desktop bounds once at startup. */
export async function loadScreen(): Promise<Screen> {
  screen = await CursorService.GetScreenSize();
  lastSentX = screen.X + screen.Width / 2;
  lastSentY = screen.Y + screen.Height / 2;
  return screen;
}

function report(err: unknown): void {
  // Swallow RPC errors during rapid gesture bursts; the next call retries.
  console.error('[cursor]', err);
}

/** Absolute move, throttled to avoid redundant RPC calls. */
export function moveCursor(x: number, y: number): void {
  if (!screen || screen.Width === 0 || screen.Height === 0) return;
  if (Math.abs(x - lastSentX) < 1.2 && Math.abs(y - lastSentY) < 1.2) return;
  lastSentX = x;
  lastSentY = y;
  CursorService.MoveCursor(Math.round(x), Math.round(y)).catch(report);
}

/** Relative move (drag mode). */
export function moveCursorRelative(dx: number, dy: number): void {
  const rx = Math.round(dx);
  const ry = Math.round(dy);
  if (rx === 0 && ry === 0) return;
  CursorService.MoveCursorRelative(rx, ry).catch(report);
}

export function leftClick(): void {
  CursorService.LeftClick().catch(report);
}

/** Returns the real current cursor position (virtual desktop coords). */
export async function getCursorPosition(): Promise<{ x: number; y: number }> {
  const [x, y] = await CursorService.GetCursorPosition();
  return { x, y };
}

export function leftDoubleClick(): void {
  CursorService.DoubleClick().catch(report);
}

export function rightClick(): void {
  CursorService.RightClick().catch(report);
}

export function leftDown(): void {
  CursorService.MouseDown().catch(report);
}

export function leftUp(): void {
  CursorService.MouseUp().catch(report);
}

export function scroll(lines: number): void {
  if (lines === 0) return;
  CursorService.Scroll(lines).catch(report);
}

export function setAlwaysOnTop(on: boolean): void {
  CursorService.SetAlwaysOnTop(on).catch(report);
}

export function setWindowSize(w: number, h: number): void {
  CursorService.SetWindowSize(w, h).catch(report);
}
