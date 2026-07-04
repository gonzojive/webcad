// Package server provides a generic web server for serving WebCAD frontend assets,
// wrapping the [runfilesserver] handler with command-line flag configuration.
package server

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

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

	// RedirectRootTo configures a redirect from "/" to the specified path (e.g., "/ui/").
	// If empty, no redirect is performed.
	RedirectRootTo string
}

// Server is a helper that wraps the http server, parses command line flags,
// and delegates request handling to [runfilesserver] with local fallback.
type Server struct {
	addr    string
	handler http.Handler
}

// New creates a new [Server] instance configured with [Options].
// It defines and parses the command-line flag: -addr.
//
// If running locally in a workspace (non-runfiles environment), it automatically
// configures local workspace source files as fallback.
func New(opts Options) *Server {
	addrFlag := flag.String("addr", opts.DefaultAddr, "Address to listen on")
	
	if !flag.Parsed() {
		flag.Parse()
	}

	// Resolve fallback directory if running locally in workspace
	var fallbackDir string
	if wd, err := os.Getwd(); err == nil {
		if root, err := findWorkspaceRoot(wd); err == nil {
			fallbackDir = filepath.Clean(filepath.Join(root, opts.WorkspaceSubpath))
			log.Printf("server: configured local workspace fallback directory: %s", fallbackDir)
		}
	}

	runfilesHandler, err := runfilesserver.New(opts.RlocationRoot, fallbackDir)
	if err != nil {
		log.Fatalf("server: failed to initialize runfiles handler: %v", err)
	}

	var handler http.Handler = runfilesHandler
	if opts.RedirectRootTo != "" {
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				http.Redirect(w, r, opts.RedirectRootTo, http.StatusMovedPermanently)
				return
			}
			runfilesHandler.ServeHTTP(w, r)
		})
	}

	return &Server{
		addr:    *addrFlag,
		handler: handler,
	}
}


// Start starts the HTTP listener and serves requests using the configured handler.
func (s *Server) Start() error {
	http.Handle("/", s.handler)
	log.Printf("WebCAD Server starting on http://localhost%s (serving via Runfiles FS)", s.addr)
	return http.ListenAndServe(s.addr, nil)
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
