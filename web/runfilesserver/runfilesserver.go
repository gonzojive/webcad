// Package runfilesserver provides an [net/http.Handler] that serves files from Bazel runfiles.
package runfilesserver

import (
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

// RunfilesServer implements [net/http.Handler] to serve files from Bazel runfiles,
// mimicking the behavior of [net/http.FileServer].
//
// If a file is not found in runfiles, it delegates to a fallback handler.
type RunfilesServer struct {
	rlocationRoot string
	fallback      http.Handler
}

// New creates a new [RunfilesServer] handler.
//
// The rlocationRoot is the runfiles-root-relative path to the assets directory (e.g. "webcad/web/poc").
// The fallback handler is called when a file is not found in runfiles (can be nil).
func New(rlocationRoot string, fallback http.Handler) *RunfilesServer {
	return &RunfilesServer{
		rlocationRoot: rlocationRoot,
		fallback:      fallback,
	}
}

// ServeHTTP implements the [net/http.Handler] interface.
//
// It mimics [net/http.FileServer] by redirecting directory requests missing a trailing slash,
// and automatically serving "index.html" for directory requests.
func (s *RunfilesServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Enforce that path starts with "/" to prevent relative path escaping during Clean.
	if !strings.HasPrefix(r.URL.Path, "/") {
		http.Error(w, "Bad Request: path must start with /", http.StatusBadRequest)
		return
	}

	origPath := r.URL.Path
	cleanedPath := path.Clean(r.URL.Path)
	// Preserve trailing slash to avoid redirect loops in fallback handlers
	if strings.HasSuffix(r.URL.Path, "/") && !strings.HasSuffix(cleanedPath, "/") {
		cleanedPath += "/"
	}
	hasTrailingSlash := strings.HasSuffix(cleanedPath, "/")
	
	// Update request path in-place for delegated handlers
	r.URL.Path = cleanedPath
	relPath := strings.TrimPrefix(cleanedPath, "/")

	// Try Bazel runfiles
	if s.rlocationRoot != "" {
		if hasTrailingSlash || cleanedPath == "/" {
			// Directory request (ends in / or is root). Try to serve index.html
			indexLogicalPath := path.Clean(path.Join(s.rlocationRoot, relPath, "index.html"))
			if s.tryServeRunfile(w, r, indexLogicalPath, origPath) {
				return
			}
		} else {
			// File request (no trailing slash).
			fileLogicalPath := path.Clean(path.Join(s.rlocationRoot, relPath))
			
			// First try as a file
			if s.tryServeRunfile(w, r, fileLogicalPath, origPath) {
				return
			}
			
			// If it failed, it might be a directory missing the trailing slash.
			// Try to resolve <dir>/index.html
			indexLogicalPath := path.Clean(path.Join(s.rlocationRoot, relPath, "index.html"))
			resolvedIndex, err := runfiles.Rlocation(indexLogicalPath)
			if err == nil {
				if _, err := os.Stat(resolvedIndex); err == nil {
					// It is logically a directory containing index.html.
					// Redirect to append trailing slash (mimic http.FileServer)
					http.Redirect(w, r, cleanedPath+"/", http.StatusMovedPermanently)
					return
				}
			}
		}
	}

	// Fallback handler
	if s.fallback != nil {
		s.fallback.ServeHTTP(w, r)
		return
	}

	log.Printf("File not found: %s", r.URL.Path)
	http.NotFound(w, r)
}

func (s *RunfilesServer) tryServeRunfile(w http.ResponseWriter, r *http.Request, logicalPath string, origPath string) bool {
	// Security: Ensure it doesn't escape the rlocationRoot
	expectedPrefix := path.Clean(s.rlocationRoot)
	if !strings.HasPrefix(logicalPath, expectedPrefix) {
		log.Printf("Security warning: attempted directory traversal in runfiles? logicalPath=%s, expectedPrefix=%s", logicalPath, expectedPrefix)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return true // handled (with error)
	}

	resolvedPath, err := runfiles.Rlocation(logicalPath)
	if err == nil {
		if stat, err := os.Stat(resolvedPath); err == nil {
			if stat.IsDir() {
				return false
			}
			// Ensure JavaScript module files have the correct MIME type
			if filepath.Ext(resolvedPath) == ".js" {
				w.Header().Set("Content-Type", "application/javascript")
			} else if filepath.Ext(resolvedPath) == ".wasm" {
				w.Header().Set("Content-Type", "application/wasm")
			}
			// Restore original path to prevent http.ServeFile from redirecting
			r.URL.Path = origPath
			http.ServeFile(w, r, resolvedPath)
			return true
		}
	}
	return false
}
