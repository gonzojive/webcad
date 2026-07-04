package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

func main() {
	var assetDir string

	// 1. Resolve asset root via official Bazel runfiles library
	if jsPath, err := runfiles.Rlocation("webcad/web/poc/ui/main.js"); err == nil {
		// jsPath points to: <runfiles_root>/webcad/web/poc/ui/main.js
		// Serve from the parent 'poc' directory so paths align logically (e.g. /ui/main.js)
		assetDir = filepath.Dir(filepath.Dir(jsPath))
		log.Printf("Serving assets from Bazel runfiles: %s", assetDir)
	} else {
		// 2. Local fallback for development outside Bazel
		wd, err := os.Getwd()
		if err != nil {
			log.Fatalf("Failed to get working directory: %v", err)
		}
		assetDir = filepath.Join(wd, "web", "poc")
		log.Printf("Serving assets from local directory fallback: %s", assetDir)
	}

	// Serve static files
	fs := http.FileServer(http.Dir(assetDir))
	http.Handle("/", fs)

	// API placeholder
	http.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status": "ok", "scaffolding": true}`))
	})

	log.Println("WebCAD Server starting on http://localhost:8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}
