// Package runfilesserver provides utilities to serve Bazel runfiles using Go's [io/fs.FS] interface.
package runfilesserver

import (
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

// UnionFS implements [io/fs.FS] by trying a primary filesystem first,
// and falling back to a secondary filesystem if the file is not found.
type UnionFS struct {
	Primary   fs.FS
	Secondary fs.FS
}

// Open implements [io/fs.FS]. It tries the primary FS first, and if it returns
// an error wrapping [fs.ErrNotExist], it tries the secondary FS.
func (u *UnionFS) Open(name string) (fs.File, error) {
	f, err := u.Primary.Open(name)
	if err == nil {
		return f, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return u.Secondary.Open(name)
	}
	return nil, err
}

// New creates an [net/http.Handler] that serves files from Bazel runfiles,
// falling back to a local filesystem directory if the file is not found in runfiles.
//
// The rlocationRoot is the runfiles-root-relative path to the assets directory (e.g. "webcad/web/poc").
// The fallbackDir is the absolute path to the local workspace directory (e.g. "/path/to/web/poc").
// If fallbackDir is empty, no fallback is used.
func New(rlocationRoot string, fallbackDir string) (http.Handler, error) {
	var fsys fs.FS

	// 1. Initialize Runfiles FS
	r, err := runfiles.New()
	if err == nil {
		// Scope the runfiles FS to the rlocationRoot
		sub, err := fs.Sub(r, rlocationRoot)
		if err == nil {
			fsys = sub
		} else {
			log.Printf("runfilesserver: failed to scope runfiles to %s: %v", rlocationRoot, err)
		}
	} else {
		log.Printf("runfilesserver: runfiles.New failed (normal if running outside Bazel): %v", err)
	}

	// 2. Initialize Fallback FS if provided
	var fallbackFS fs.FS
	if fallbackDir != "" {
		if _, err := os.Stat(fallbackDir); err != nil {
			return nil, fmt.Errorf("runfilesserver: fallback directory %s invalid: %w", fallbackDir, err)
		}
		fallbackFS = os.DirFS(fallbackDir)
	}

	// 3. Combine them into UnionFS
	var finalFS fs.FS
	if fsys != nil && fallbackFS != nil {
		finalFS = &UnionFS{Primary: fsys, Secondary: fallbackFS}
	} else if fsys != nil {
		finalFS = fsys
	} else if fallbackFS != nil {
		finalFS = fallbackFS
	} else {
		return nil, errors.New("runfilesserver: neither runfiles nor fallback directory could be initialized")
	}

	// 4. Wrap with http.FileServer and custom middleware
	fileServer := http.FileServer(http.FS(finalFS))
	return &runfilesHandler{
		fsys: finalFS,
		next: fileServer,
	}, nil
}

// runfilesHandler wraps http.FileServer to enforce MIME types and disable directory listing.
type runfilesHandler struct {
	fsys fs.FS
	next http.Handler
}

func (h *runfilesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Enforce that path starts with "/" to prevent relative path escaping during Clean.
	if !strings.HasPrefix(r.URL.Path, "/") {
		http.Error(w, "Bad Request: path must start with /", http.StatusBadRequest)
		return
	}

	cleaned := path.Clean(r.URL.Path)
	
	// 1. Disable directory listing: if request is for a directory, index.html must exist
	if strings.HasSuffix(r.URL.Path, "/") || cleaned == "." || cleaned == "/" {
		relPath := strings.TrimPrefix(cleaned, "/")
		indexPath := path.Join(relPath, "index.html")
		f, err := h.fsys.Open(indexPath)
		if err != nil {
			// index.html missing or error, return 404 to prevent listing
			http.NotFound(w, r)
			return
		}
		f.Close()
	}

	// 2. Set explicit MIME types for files that might not be registered in the host OS
	if strings.HasSuffix(cleaned, ".js") {
		w.Header().Set("Content-Type", "application/javascript")
	} else if strings.HasSuffix(cleaned, ".wasm") {
		w.Header().Set("Content-Type", "application/wasm")
	}

	h.next.ServeHTTP(w, r)
}
