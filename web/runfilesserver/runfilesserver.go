// Package runfilesserver provides an [net/http.Handler] that serves files from Bazel runfiles.
package runfilesserver

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

// RunfilesServer implements [net/http.Handler] to serve files from Bazel runfiles,
// with fallbacks for local workspace source trees.
type RunfilesServer struct {
	workspaceName      string
	workspaceSubpath   string
	indexHTML          string
	localWorkspaceRoot string
	localOverrideDir   string
}

// New creates a new [RunfilesServer] handler.
//
// The workspaceName is the apparent name of the Bazel workspace (e.g. "webcad").
// The workspaceSubpath is the path relative to the workspace root containing the assets (e.g. "web/poc").
// The indexHTML is the path relative to workspaceSubpath to serve at "/" (defaults to "ui/index.html").
func New(workspaceName, workspaceSubpath, indexHTML string) *RunfilesServer {
	if indexHTML == "" {
		indexHTML = "ui/index.html"
	}

	s := &RunfilesServer{
		workspaceName:    workspaceName,
		workspaceSubpath: workspaceSubpath,
		indexHTML:        indexHTML,
	}

	// Try to locate workspace root via filesystem walk-up for fallback
	if wd, err := os.Getwd(); err == nil {
		if root, err := findWorkspaceRoot(wd); err == nil {
			s.localWorkspaceRoot = root
		}
	}

	return s
}

// SetLocalOverrideDir sets a local directory to serve from directly, bypassing runfiles.
// Useful for development overrides.
func (s *RunfilesServer) SetLocalOverrideDir(dir string) {
	s.localOverrideDir = dir
}

// ServeHTTP implements the [net/http.Handler] interface.
func (s *RunfilesServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Enforce that path starts with "/" to prevent relative path escaping during Clean.
	if !strings.HasPrefix(r.URL.Path, "/") {
		http.Error(w, "Bad Request: path must start with /", http.StatusBadRequest)
		return
	}

	// Clean the path to resolve ".." and "." segments.
	path := filepath.Clean(r.URL.Path)
	if path == "/" {
		path = "/" + s.indexHTML
	}
	relPath := strings.TrimPrefix(path, "/")

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
			// Ensure JavaScript module files have the correct MIME type
			if filepath.Ext(resolvedPath) == ".js" {
				w.Header().Set("Content-Type", "application/javascript")
			} else if filepath.Ext(resolvedPath) == ".wasm" {
				w.Header().Set("Content-Type", "application/wasm")
			}
			http.ServeFile(w, r, resolvedPath)
			return
		}
	}

	// 3. Fallback to local workspace source tree
	if s.localWorkspaceRoot != "" && s.workspaceSubpath != "" {
		localPath := filepath.Clean(filepath.Join(s.localWorkspaceRoot, s.workspaceSubpath, relPath))
		expectedLocalPrefix := filepath.Clean(filepath.Join(s.localWorkspaceRoot, s.workspaceSubpath))
		
		// Ensure it doesn't escape the local workspace subpath
		if !strings.HasPrefix(localPath, expectedLocalPrefix) {
			log.Printf("Security warning: attempted directory traversal in fallback? path=%s, localPath=%s, expectedPrefix=%s", r.URL.Path, localPath, expectedLocalPrefix)
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		
		if _, err := os.Stat(localPath); err == nil {
			if filepath.Ext(localPath) == ".js" {
				w.Header().Set("Content-Type", "application/javascript")
			}
			http.ServeFile(w, r, localPath)
			return
		}
	}

	log.Printf("File not found: %s", path)
	http.NotFound(w, r)
}

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
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("workspace root not found")
}
