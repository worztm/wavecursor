package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"wavecursor/internal/cursor"
)

// CursorService exposes mouse control to the frontend. Every exported
// method becomes a typed, promise-returning function in the JS bindings.
type CursorService struct{}

// Screen describes the usable desktop area (the union of all monitors).
type Screen struct {
	X, Y     int  // origin of the virtual desktop (can be negative)
	Width    int  // total width in pixels
	Height   int  // total height in pixels
	FlippedY bool // true on macOS (origin is bottom-left)
}

// GetScreenSize returns the desktop bounds used to map hand positions to pixels.
func (c *CursorService) GetScreenSize() Screen {
	x, y, w, h := cursor.ScreenBounds()
	return Screen{X: x, Y: y, Width: w, Height: h, FlippedY: cursor.FlippedYAxis()}
}

// MoveCursor moves the cursor to an absolute position on the virtual desktop.
func (c *CursorService) MoveCursor(x, y int) {
	cursor.MoveTo(x, y)
}

// MoveCursorRelative moves the cursor by a pixel delta (used while dragging).
func (c *CursorService) MoveCursorRelative(dx, dy int) {
	cursor.MoveBy(dx, dy)
}

// GetCursorPosition returns the current absolute cursor position.
func (c *CursorService) GetCursorPosition() (int, int) {
	return cursor.Position()
}

// LeftClick performs a left click at the current cursor position.
func (c *CursorService) LeftClick() {
	cursor.LeftClick()
}

// RightClick performs a right click at the current cursor position.
func (c *CursorService) RightClick() {
	cursor.RightClick()
}

// DoubleClick performs a double left click at the current cursor position.
func (c *CursorService) DoubleClick() {
	cursor.DoubleClick()
}

// MouseDown holds the left button down (start of a drag).
func (c *CursorService) MouseDown() {
	cursor.LeftDown()
}

// MouseUp releases the left button (end of a drag).
func (c *CursorService) MouseUp() {
	cursor.LeftUp()
}

// Scroll rotates the wheel. Positive = up, negative = down.
func (c *CursorService) Scroll(delta int) {
	cursor.Scroll(delta)
}

// SetAlwaysOnTop toggles whether the control window floats above other apps
// so the camera keeps tracking while you use other windows.
func (c *CursorService) SetAlwaysOnTop(on bool) {
	app := application.Get()
	if app == nil {
		return
	}
	window := app.Window.Current()
	if window != nil {
		window.SetAlwaysOnTop(on)
	}
}

// SetWindowSize resizes the control window (used by the compact mode toggle).
func (c *CursorService) SetWindowSize(width, height int) {
	app := application.Get()
	if app == nil {
		return
	}
	if window := app.Window.Current(); window != nil {
		window.SetSize(width, height)
	}
}
