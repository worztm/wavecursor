// Package cursor provides low-level mouse control with per-OS
// implementations selected via build tags.
package cursor

// ScreenBounds returns the bounds of the virtual desktop
// (the union of all connected monitors).
//
// The origin can be negative when a monitor sits above or to the
// left of the primary display.
func ScreenBounds() (x, y, width, height int) {
	return platformScreenBounds()
}

// FlippedYAxis reports whether the platform's native coordinate system
// places the origin at the bottom-left (macOS) instead of the top-left.
func FlippedYAxis() bool {
	return platformFlippedY()
}

// MoveTo moves the cursor to an absolute position in virtual desktop
// coordinates.
func MoveTo(x, y int) {
	platformMoveTo(x, y)
}

// MoveBy moves the cursor by a relative delta in pixels.
func MoveBy(dx, dy int) {
	platformMoveBy(dx, dy)
}

// Position returns the current absolute cursor position.
func Position() (x, y int) {
	return platformPosition()
}

// LeftDown presses the left mouse button without releasing it.
func LeftDown() {
	platformLeftDown()
}

// LeftUp releases the left mouse button.
func LeftUp() {
	platformLeftUp()
}

// RightDown presses the right mouse button without releasing it.
func RightDown() {
	platformRightDown()
}

// RightUp releases the right mouse button.
func RightUp() {
	platformRightUp()
}

// LeftClick performs a single left click at the current position.
func LeftClick() {
	platformLeftDown()
	platformLeftUp()
}

// RightClick performs a single right click at the current position.
func RightClick() {
	platformRightDown()
	platformRightUp()
}

// DoubleClick performs a rapid double left click.
func DoubleClick() {
	platformLeftClickTwice()
}

// Scroll rotates the wheel. Positive values scroll up, negative down.
// One unit roughly equals one wheel notch.
func Scroll(lines int) {
	platformScroll(lines)
}
