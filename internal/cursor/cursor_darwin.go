//go:build darwin

package cursor

/*
#cgo LDFLAGS: -framework CoreGraphics
#include <CoreGraphics/CoreGraphics.h>
#include <stdlib.h>

static void cgMoveTo(double x, double y) {
	CGEventRef e = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved,
		CGPointMake(x, y), kCGMouseButtonLeft);
	CGEventPost(kCGHIDEventTap, e);
	CFRelease(e);
}

static void cgMoveBy(double dx, double dy) {
	CGPoint cur = CGEventGetLocation(NULL);
	CGEventRef e = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved,
		CGPointMake(cur.x + dx, cur.y + dy), kCGMouseButtonLeft);
	CGEventPost(kCGHIDEventTap, e);
	CFRelease(e);
}

static void cgButton(int down, int right) {
	CGEventType t;
	CGMouseButton b = right ? kCGMouseButtonRight : kCGMouseButtonLeft;
	if (down && right) t = kCGEventRightMouseDown;
	else if (down) t = kCGEventLeftMouseDown;
	else if (right) t = kCGEventRightMouseUp;
	else t = kCGEventLeftMouseUp;
	CGPoint cur = CGEventGetLocation(NULL);
	CGEventRef e = CGEventCreateMouseEvent(NULL, t, cur, b);
	CGEventPost(kCGHIDEventTap, e);
	CFRelease(e);
}

static void cgScroll(int lines) {
	// Positive lines scroll up; CoreGraphics expects negative for up.
	CGEventRef e = CGEventCreateScrollWheelEvent(NULL,
		kCGScrollEventUnitLine, 1, -(int32_t)lines);
	CGEventPost(kCGHIDEventTap, e);
	CFRelease(e);
}

static void cgScreenBounds(double *x, double *y, double *w, double *h) {
	CGDisplayCount count;
	CGDirectDisplayID displays[16];
	CGGetActiveDisplayList(16, displays, &count);
	CGRect unionRect = CGRectNull;
	for (CGDisplayCount i = 0; i < count; i++) {
		CGRect r = CGDisplayBounds(displays[i]);
		if (CGRectIsNull(unionRect)) unionRect = r;
		else unionRect = CGRectUnion(unionRect, r);
	}
	*x = unionRect.origin.x;
	*y = unionRect.origin.y;
	*w = unionRect.size.width;
	*h = unionRect.size.height;
}
*/
import "C"

import "time"

func platformScreenBounds() (x, y, width, height int) {
	var cx, cy, cw, ch C.double
	C.cgScreenBounds(&cx, &cy, &cw, &ch)
	return int(cx), int(cy), int(cw), int(ch)
}

// macOS uses a bottom-left origin, so the frontend must flip the Y axis.
func platformFlippedY() bool { return true }

func platformMoveTo(x, y int) {
	C.cgMoveTo(C.double(x), C.double(y))
}

func platformMoveBy(dx, dy int) {
	C.cgMoveBy(C.double(dx), C.double(dy))
}

func platformPosition() (x, y int) {
	cur := C.CGEventGetLocation(nil)
	return int(cur.x), int(cur.y)
}

func platformLeftDown()  { C.cgButton(1, 0) }
func platformLeftUp()    { C.cgButton(0, 0) }
func platformRightDown() { C.cgButton(1, 1) }
func platformRightUp()   { C.cgButton(0, 1) }

func platformLeftClickTwice() {
	platformLeftDown()
	platformLeftUp()
	time.Sleep(30 * time.Millisecond)
	platformLeftDown()
	platformLeftUp()
}

func platformScroll(lines int) {
	C.cgScroll(C.int(lines))
}
