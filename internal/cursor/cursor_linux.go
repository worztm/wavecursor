//go:build linux

package cursor

/*
#cgo LDFLAGS: -lX11 -lXtst
#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>

static int xtestAvailable(Display *dpy) {
	int ev, err, major, minor;
	return XTestQueryExtension(dpy, &ev, &err, &major, &minor);
}

static void xtestMoveTo(Display *dpy, int screen, int x, int y) {
	XTestFakeMotionEvent(dpy, screen, x, y, 0);
	XFlush(dpy);
}

static void xtestMoveBy(Display *dpy, int dx, int dy) {
	XTestFakeRelativeMotionEvent(dpy, dx, dy, 0);
	XFlush(dpy);
}

static void xtestButton(Display *dpy, int button, int down) {
	XTestFakeButtonEvent(dpy, button, down, 0);
	XFlush(dpy);
}
*/
import "C"

import (
	"sync"
	"time"
)

var (
	displayOnce sync.Once
	display     *C.Display
)

// getDisplay lazily opens the X11 connection. On Wayland (where X11 is
// unavailable), the cursor functions are no-ops.
func getDisplay() *C.Display {
	displayOnce.Do(func() {
		display = C.XOpenDisplay(nil)
	})
	return display
}

func screenIndex(dpy *C.Display) int {
	return int(C.DefaultScreen(dpy))
}

func platformScreenBounds() (x, y, width, height int) {
	dpy := getDisplay()
	if dpy == nil {
		return 0, 0, 0, 0
	}
	// Note: this reports the primary screen. Multi-monitor setups are not
	// merged; the frontend maps into the primary display space.
	return 0, 0,
		int(C.DisplayWidth(dpy, C.int(screenIndex(dpy)))),
		int(C.DisplayHeight(dpy, C.int(screenIndex(dpy))))
}

func platformFlippedY() bool { return false }

func platformMoveTo(x, y int) {
	dpy := getDisplay()
	if dpy == nil {
		return
	}
	C.xtestMoveTo(dpy, C.int(screenIndex(dpy)), C.int(x), C.int(y))
}

func platformMoveBy(dx, dy int) {
	dpy := getDisplay()
	if dpy == nil {
		return
	}
	C.xtestMoveBy(dpy, C.int(dx), C.int(dy))
}

func platformPosition() (x, y int) {
	dpy := getDisplay()
	if dpy == nil {
		return 0, 0
	}
	var root C.Window
	var rx, ry, wx, wy C.int
	var mask C.uint
	_ = C.XQueryPointer(dpy, C.DefaultRootWindow(dpy), &root, &root, &rx, &ry, &wx, &wy, &mask)
	return int(rx), int(ry)
}

func platformLeftDown() {
	if dpy := getDisplay(); dpy != nil {
		C.xtestButton(dpy, 1, 1)
	}
}

func platformLeftUp() {
	if dpy := getDisplay(); dpy != nil {
		C.xtestButton(dpy, 1, 0)
	}
}

func platformRightDown() {
	if dpy := getDisplay(); dpy != nil {
		C.xtestButton(dpy, 3, 1)
	}
}

func platformRightUp() {
	if dpy := getDisplay(); dpy != nil {
		C.xtestButton(dpy, 3, 0)
	}
}

func platformLeftClickTwice() {
	platformLeftDown()
	platformLeftUp()
	time.Sleep(30 * time.Millisecond)
	platformLeftDown()
	platformLeftUp()
}

func platformScroll(lines int) {
	dpy := getDisplay()
	if dpy == nil {
		return
	}
	// X11 scroll buttons: 4 = up, 5 = down.
	button := 4
	if lines < 0 {
		button = 5
		lines = -lines
	}
	if lines > 10 {
		lines = 10
	}
	// Keep the call synchronous so scrolling does not lag the hand.
	for i := 0; i < lines; i++ {
		C.xtestButton(dpy, C.int(button), 1)
		C.xtestButton(dpy, C.int(button), 0)
	}
}
