package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	// Root handler: serve index.html or fallback to local files
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, "poc/ui/index.html")
			return
		}

		// Ensure JavaScript module files have the correct MIME type
		if filepath.Ext(r.URL.Path) == ".js" {
			w.Header().Set("Content-Type", "application/javascript")
		}

		// Serve from poc directory
		http.FileServer(http.Dir("poc")).ServeHTTP(w, r)
	})

	// Explicit handler for WASM bindgen files (handles WASM mime-type and Bazel sandbox path resolution)
	http.HandleFunc("/dist/solver-wasm/solver_wasm_bindgen/", func(w http.ResponseWriter, r *http.Request) {
		relPath := r.URL.Path[len("/dist/solver-wasm/solver_wasm_bindgen/"):]

		if filepath.Ext(relPath) == ".wasm" {
			w.Header().Set("Content-Type", "application/wasm")
		} else if filepath.Ext(relPath) == ".js" {
			w.Header().Set("Content-Type", "application/javascript")
		}

		// Search paths in Bazel runfiles or workspace directory
		runfilesDir := os.Getenv("RUNFILES_DIR")
		workspaceName := "gonzojive_webcad" // Check default workspace name or fallback to _main
		
		paths := []string{
			// Direct Bazel sandbox path
			filepath.Join("poc/solver-wasm/solver_wasm_bindgen", relPath),
			// Runfiles fallback (_main)
			filepath.Join(runfilesDir, "_main/poc/solver-wasm/solver_wasm_bindgen", relPath),
			// Runfiles workspace name fallback
			filepath.Join(runfilesDir, workspaceName+"/poc/solver-wasm/solver_wasm_bindgen", relPath),
		}

		for _, p := range paths {
			if _, err := os.Stat(p); err == nil {
				http.ServeFile(w, r, p)
				return
			}
		}

		log.Printf("WASM Bindgen file not found: %s", relPath)
		http.NotFound(w, r)
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
