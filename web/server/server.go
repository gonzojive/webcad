// Package server provides a generic web server for serving WebCAD frontend assets,
// wrapping the [runfilesserver.RunfilesServer] with command-line flag configuration
// and local workspace source tree fallback.
package server

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gonzojive/webcad/web/runfilesserver"
)

// Options configures the [Server] instance.
type Options struct {
	// DefaultAddr is the default address to listen on (e.g. ":8080").
	// Can be overridden by the -addr flag if registered.
	DefaultAddr string

	// RlocationRoot is the runfiles-root-relative path to the assets directory (e.g. "webcad/web/poc").
	RlocationRoot string

	// WorkspaceSubpath is the path relative to the workspace root where the assets are located
	// (e.g., "web/poc"). Used for local fallback serving.
	WorkspaceSubpath string
}

// Server is a helper that wraps the http server, parses command line flags,
// and delegates request handling to [runfilesserver.RunfilesServer] with local fallback.
type Server struct {
	addr    string
	handler http.Handler
}

// New creates a new [Server] instance configured with [Options].
// It defines and parses the command-line flag: -addr.
//
// If running locally in a workspace (non-runfiles environment), it automatically
// configures a fallback handler pointing to the local workspace source files.
func New(opts Options) *Server {
	addrFlag := flag.String("addr", opts.DefaultAddr, "Address to listen on")
	
	if !flag.Parsed() {
		flag.Parse()
	}

	// Configure runfiles serving with local workspace fallback
	var fallback http.Handler
	// Try to locate workspace root via filesystem walk-up for fallback
	if wd, err := os.Getwd(); err == nil {
		if root, err := findWorkspaceRoot(wd); err == nil {
			fallbackDir := filepath.Clean(filepath.Join(root, opts.WorkspaceSubpath))
			fallback = &localSafeFileServer{
				dir:        fallbackDir,
				fileServer: http.FileServer(http.Dir(fallbackDir)),
			}
			log.Printf("Configured local workspace fallback serving from: %s", fallbackDir)
		}
	}

	rs := runfilesserver.New(opts.RlocationRoot, fallback)

	return &Server{
		addr:    *addrFlag,
		handler: rs,
	}
}

// Start starts the HTTP listener and serves requests using the configured handler.
func (s *Server) Start() error {
	http.Handle("/", s.handler)
	log.Printf("WebCAD Server starting on http://localhost%s (serving via RunfilesServer)", s.addr)
	return http.ListenAndServe(s.addr, nil)
}

// localSafeFileServer wraps http.FileServer to enforce security boundaries
// (directory traversal protection) when serving from the local filesystem fallback.
type localSafeFileServer struct {
	dir        string
	fileServer http.Handler
}

func (h *localSafeFileServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// The path in r.URL.Path has already been cleaned and resolved
	// by RunfilesServer before it delegates here.
	relPath := strings.TrimPrefix(r.URL.Path, "/")
	
	localPath := filepath.Clean(filepath.Join(h.dir, relPath))
	expectedPrefix := filepath.Clean(h.dir)
	
	// Enforce directory traversal protection
	if !strings.HasPrefix(localPath, expectedPrefix) {
		log.Printf("Security warning: attempted directory traversal in fallback? path=%s, localPath=%s, expectedPrefix=%s", r.URL.Path, localPath, expectedPrefix)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Add JS MIME type helper for local fallback serving (some platforms don't register it)
	if filepath.Ext(localPath) == ".js" {
		w.Header().Set("Content-Type", "application/javascript")
	}

	h.fileServer.ServeHTTP(w, r)
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
