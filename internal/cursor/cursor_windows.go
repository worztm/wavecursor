//go:build windows

package cursor

import (
	"syscall"
	"time"
	"unsafe"
)

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	procSetCursorPos     = user32.NewProc("SetCursorPos")
	procGetCursorPos     = user32.NewProc("GetCursorPos")
	procMouseEvent       = user32.NewProc("mouse_event")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

// GetSystemMetrics indices for the virtual (multi-monitor) screen.
const (
	smXVirtualScreen    = 76
	smYVirtualScreen    = 77
	smCxVirtualScreen   = 78
	smCyVirtualScreen   = 79
)

// mouse_event flags.
const (
	mouseeventfMove      = 0x0001
	mouseeventfLeftDown  = 0x0002
	mouseeventfLeftUp    = 0x0004
	mouseeventfRightDown = 0x0008
	mouseeventfRightUp   = 0x0010
	mouseeventfWheel     = 0x0800
)

// wheelDelta is the number of lines per wheel notch on Windows.
const wheelDelta = 120

type point struct {
	X, Y int32
}

func getSystemMetrics(index int) int {
	ret, _, _ := procGetSystemMetrics.Call(uintptr(index))
	return int(ret)
}

func platformScreenBounds() (x, y, width, height int) {
	return getSystemMetrics(smXVirtualScreen),
		getSystemMetrics(smYVirtualScreen),
		getSystemMetrics(smCxVirtualScreen),
		getSystemMetrics(smCyVirtualScreen)
}

func platformFlippedY() bool { return false }

func platformMoveTo(x, y int) {
	// SetCursorPos accepts virtual-screen coordinates (can be negative).
	procSetCursorPos.Call(uintptr(x), uintptr(y))
}

func platformMoveBy(dx, dy int) {
	// Without MOUSEEVENTF_ABSOLUTE, dx/dy are treated as relative deltas.
	procMouseEvent.Call(mouseeventfMove, uintptr(dx), uintptr(dy), 0, 0)
}

func platformPosition() (x, y int) {
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	return int(pt.X), int(pt.Y)
}

func platformLeftDown() {
	procMouseEvent.Call(mouseeventfLeftDown, 0, 0, 0, 0)
}

func platformLeftUp() {
	procMouseEvent.Call(mouseeventfLeftUp, 0, 0, 0, 0)
}

func platformRightDown() {
	procMouseEvent.Call(mouseeventfRightDown, 0, 0, 0, 0)
}

func platformRightUp() {
	procMouseEvent.Call(mouseeventfRightUp, 0, 0, 0, 0)
}

// platformLeftClickTwice sends two clicks spaced closely enough that
// applications treat them as a double click.
func platformLeftClickTwice() {
	platformLeftDown()
	platformLeftUp()
	time.Sleep(30 * time.Millisecond)
	platformLeftDown()
	platformLeftUp()
}

func platformScroll(lines int) {
	if lines == 0 {
		return
	}
	// Positive lines scroll up, matching the sign convention of the app.
	delta := lines * wheelDelta
	procMouseEvent.Call(mouseeventfWheel, 0, 0, uintptr(delta), 0)
}
