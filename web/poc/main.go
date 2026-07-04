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
		// 2. Local fallback for development outside Bazel (e.g. `go run poc/main.go`)
		wd, err := os.Getwd()
		if err != nil {
			log.Fatalf("Failed to get working directory: %v", err)
		}
		assetDir = filepath.Join(wd, "web", "poc")
		log.Printf("Serving assets from local directory fallback: %s", assetDir)
	}

	fs := http.FileServer(http.Dir(assetDir))

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		ext := filepath.Ext(r.URL.Path)
		if ext == ".js" {
			w.Header().Set("Content-Type", "application/javascript")
		} else if ext == ".wasm" {
			w.Header().Set("Content-Type", "application/wasm")
		}

		if r.URL.Path == "/" {
			http.ServeFile(w, r, filepath.Join(assetDir, "ui/index.html"))
			return
		}

		// Non-Bazel fallback: check 'dist' folder if file doesn't exist in source root
		localPath := filepath.Join(assetDir, r.URL.Path)
		if _, err := os.Stat(localPath); os.IsNotExist(err) {
			distPath := filepath.Join(assetDir, "dist", r.URL.Path)
			if _, err := os.Stat(distPath); err == nil {
				http.ServeFile(w, r, distPath)
				return
			}
		}

		fs.ServeHTTP(w, r)
	})

	port := "8080"
	if envPort := os.Getenv("PORT"); envPort != "" {
		port = envPort
	}

	log.Printf("WebCAD Server starting on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
