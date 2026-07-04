// Package server provides a generic web server for serving WebCAD frontend assets,
// wrapping the [runfilesserver.RunfilesServer] with command-line flag configuration.
package server

import (
	"flag"
	"log"
	"net/http"

	"github.com/gonzojive/webcad/web/runfilesserver"
)

// Options configures the [Server] instance.
type Options struct {
	// DefaultAddr is the default address to listen on (e.g. ":8080").
	// Can be overridden by the -addr flag if registered.
	DefaultAddr string

	// RunfilesMarker is a runfile path used to locate the assets directory in runfiles
	// (e.g., "webcad/web/poc/ui/main.js").
	RunfilesMarker string

	// WorkspaceSubpath is the path relative to the workspace root where the assets are located
	// (e.g., "web/poc").
	WorkspaceSubpath string

	// IndexHTML is the path relative to WorkspaceSubpath to serve at "/" (e.g., "ui/index.html").
	IndexHTML string
}

// Server is a helper that wraps the http server, parses command line flags,
// and delegates request handling to [runfilesserver.RunfilesServer].
type Server struct {
	addr    string
	handler http.Handler
}

// New creates a new [Server] instance configured with [Options].
// It defines and parses command-line flags: -addr and -assets_dir.
func New(opts Options) *Server {
	addrFlag := flag.String("addr", opts.DefaultAddr, "Address to listen on")
	assetsDirFlag := flag.String("assets_dir", "", "Path to the assets directory (optional override, bypasses runfiles)")
	
	if !flag.Parsed() {
		flag.Parse()
	}

	rs := runfilesserver.New(opts.RunfilesMarker, opts.WorkspaceSubpath, opts.IndexHTML)
	if *assetsDirFlag != "" {
		rs.SetLocalOverrideDir(*assetsDirFlag)
	}

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
