package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Wails embeds the built frontend into the binary. The dist folder is
// produced by `wails3 build` / `wails3 dev`.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name:        "wavecursor",
		Description: "Control your computer cursor with hand gestures using your camera",
		Services: []application.Service{
			application.NewService(&CursorService{}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		// Disable Chromium/WebView2 background throttling so hand tracking keeps
		// running at full speed when the window is covered by other apps.
		Windows: application.WindowsOptions{
			AdditionalBrowserArgs: []string{
				"--disable-backgrounding-occluded-windows",
				"--disable-renderer-backgrounding",
				"--disable-background-timer-throttling",
				"--disable-background-video-track-optimizations",
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// The window stays on top by default so the camera keeps tracking while
	// the user works in other applications. It can be toggled from the UI.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "WaveCursor — camera cursor control",
		Width:     1180,
		Height:    780,
		MinWidth:  940,
		MinHeight: 640,
		// Keep the panel above other windows: the webview is never occluded,
		// so video processing is not throttled while you use other apps.
		AlwaysOnTop: true,
		// Grant the webview access to the camera without a prompt.
		Permissions: map[application.PermissionType]application.Permission{
			application.PermissionCamera: application.PermissionAllow,
		},
		BackgroundColour: application.NewRGB(13, 15, 20),
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
