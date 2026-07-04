package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

var assetsDirFlag = flag.String("assets_dir", "", "Path to the assets directory (optional)")

func main() {
	flag.Parse()

	assetDir := findAssetDir(*assetsDirFlag)

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

// findAssetDir resolves the directory containing static assets.
// It tries the following in order:
// 1. A command-line flag -assets_dir (if provided).
// 2. Bazel runfiles (if running under Bazel).
// 3. Finding the workspace root by walking up from the current directory
//    and looking for "go.mod" or "MODULE.bazel", then appending "web/poc".
// 4. Falling back to the current working directory.
func findAssetDir(flagValue string) string {
	// 1. Flag overrides everything
	if flagValue != "" {
		log.Printf("Using assets directory from flag: %s", flagValue)
		return flagValue
	}

	// 2. Try Bazel runfiles
	if jsPath, err := runfiles.Rlocation("webcad/web/poc/ui/main.js"); err == nil {
		assetDir := filepath.Dir(filepath.Dir(jsPath))
		log.Printf("Serving assets from Bazel runfiles: %s", assetDir)
		return assetDir
	}

	// 3. Try to locate workspace root
	if wd, err := os.Getwd(); err == nil {
		if root, err := findWorkspaceRoot(wd); err == nil {
			assetDir := filepath.Join(root, "web", "poc")
			log.Printf("Located workspace root, serving assets from: %s", assetDir)
			return assetDir
		}
	}

	// 4. Last resort fallback to current working directory
	wd, _ := os.Getwd()
	log.Printf("Fallback: serving assets from current working directory: %s", wd)
	return wd
}

// findWorkspaceRoot walks up from startDir looking for go.mod or MODULE.bazel.
func findWorkspaceRoot(startDir string) (string, error) {
	dir := startDir
	for {
		if _, err := os.Stat(filepath.Join(dir, "MODULE.bazel")); err == nil {
			return dir, nil
		}
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break // Reached filesystem root
		}
		dir = parent
	}
	return "", fmt.Errorf("workspace root not found")
}
