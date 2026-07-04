// Package runfilesserver provides an [net/http.Handler] that serves files from Bazel runfiles.
package runfilesserver

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

// RunfilesServer implements [net/http.Handler] to serve files from Bazel runfiles.
// If a file is not found in runfiles, it can delegate to a fallback handler.
type RunfilesServer struct {
	workspaceName    string
	workspaceSubpath string
	indexHTML        string
	fallback         http.Handler
	localOverrideDir string
}

// New creates a new [RunfilesServer] handler.
//
// The workspaceName is the apparent name of the Bazel workspace (e.g. "webcad").
// The workspaceSubpath is the path relative to the workspace root containing the assets (e.g. "web/poc").
// The indexHTML is the path relative to workspaceSubpath to serve at "/" (defaults to "ui/index.html").
// The fallback handler is called when a file is not found in runfiles (can be nil).
func New(workspaceName, workspaceSubpath, indexHTML string, fallback http.Handler) *RunfilesServer {
	if indexHTML == "" {
		indexHTML = "ui/index.html"
	}

	return &RunfilesServer{
		workspaceName:    workspaceName,
		workspaceSubpath: workspaceSubpath,
		indexHTML:        indexHTML,
		fallback:         fallback,
	}
}

// SetLocalOverrideDir sets a local directory to serve from directly, bypassing runfiles.
// Useful for development overrides.
func (s *RunfilesServer) SetLocalOverrideDir(dir string) {
	s.localOverrideDir = dir
}

// ServeHTTP implements the [net/http.Handler] interface.
//
// It mutates r.URL.Path in-place to clean it and apply the indexHTML fallback
// before attempting to resolve it or delegating to the fallback handler.
func (s *RunfilesServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Enforce that path starts with "/" to prevent relative path escaping during Clean.
	if !strings.HasPrefix(r.URL.Path, "/") {
		http.Error(w, "Bad Request: path must start with /", http.StatusBadRequest)
		return
	}

	origPath := r.URL.Path

	// Clean the path to resolve ".." and "." segments.
	r.URL.Path = filepath.Clean(r.URL.Path)
	if r.URL.Path == "/" {
		r.URL.Path = "/" + s.indexHTML
	}
	relPath := strings.TrimPrefix(r.URL.Path, "/")

	// 1. Manual local override (highest priority if set)
	if s.localOverrideDir != "" {
		localPath := filepath.Clean(filepath.Join(s.localOverrideDir, relPath))
		expectedManualPrefix := filepath.Clean(s.localOverrideDir)
		if !strings.HasPrefix(localPath, expectedManualPrefix) {
			log.Printf("Security warning: attempted directory traversal in manual override? path=%s, localPath=%s, expectedPrefix=%s", r.URL.Path, localPath, expectedManualPrefix)
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		if _, err := os.Stat(localPath); err == nil {
			http.ServeFile(w, r, localPath)
			return
		}
		http.NotFound(w, r)
		return
	}

	// 2. Try Bazel runfiles
	if s.workspaceName != "" && s.workspaceSubpath != "" {
		// Construct logical runfiles path (rlocation path): <workspace>/<subpath>/<request_path>
		runfilesPath := filepath.Clean(filepath.Join(s.workspaceName, s.workspaceSubpath, relPath))
		expectedRunfilesPrefix := filepath.Clean(filepath.Join(s.workspaceName, s.workspaceSubpath))
		
		// Ensure it doesn't escape the workspace subpath (directory traversal protection)
		if !strings.HasPrefix(runfilesPath, expectedRunfilesPrefix) {
			log.Printf("Security warning: attempted directory traversal in runfiles? path=%s, runfilesPath=%s, expectedPrefix=%s", r.URL.Path, runfilesPath, expectedRunfilesPrefix)
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		
		resolvedPath, err := runfiles.Rlocation(runfilesPath)
		if err == nil {
			// runfiles.Rlocation might return a path even if the file doesn't exist
			// (e.g. in directory-based runfiles environments). We must verify existence.
			if _, err := os.Stat(resolvedPath); err == nil {
				// Ensure JavaScript module files have the correct MIME type
				if filepath.Ext(resolvedPath) == ".js" {
					w.Header().Set("Content-Type", "application/javascript")
				} else if filepath.Ext(resolvedPath) == ".wasm" {
					w.Header().Set("Content-Type", "application/wasm")
				}
				// Restore original path to prevent http.ServeFile from redirecting
				// requests that we internally rewrote (like "/" to "/ui/index.html").
				r.URL.Path = origPath
				http.ServeFile(w, r, resolvedPath)
				return
			}
		}
	}

	// 3. Fallback handler
	if s.fallback != nil {
		s.fallback.ServeHTTP(w, r)
		return
	}

	log.Printf("File not found: %s", r.URL.Path)
	http.NotFound(w, r)
}
