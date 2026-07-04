// Package server provides a generic web server for serving WebCAD frontend assets.
package server

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

// Options configures the WebCAD web server.
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
}

// Server wraps the http server and handles asset resolution.
type Server struct {
	opts      Options
	assetsDir string
	addr      string
}

// New creates a new Server instance.
// It defines and parses flags: -addr and -assets_dir.
func New(opts Options) *Server {
	addrFlag := flag.String("addr", opts.DefaultAddr, "Address to listen on")
	assetsDirFlag := flag.String("assets_dir", "", "Path to the assets directory (optional override)")
	
	// Check if flags are already parsed (e.g. by the caller)
	if !flag.Parsed() {
		flag.Parse()
	}

	s := &Server{
		opts: opts,
		addr: *addrFlag,
	}

	s.assetsDir = s.resolveAssetDir(*assetsDirFlag)
	return s
}

// Start starts the HTTP server.
func (s *Server) Start() error {
	fs := http.FileServer(http.Dir(s.assetsDir))
	http.Handle("/", fs)

	log.Printf("WebCAD Server starting on http://localhost%s (serving %s)", s.addr, s.assetsDir)
	return http.ListenAndServe(s.addr, nil)
}

// AssetsDir returns the resolved assets directory.
func (s *Server) AssetsDir() string {
	return s.assetsDir
}

func (s *Server) resolveAssetDir(flagValue string) string {
	// 1. Flag override
	if flagValue != "" {
		log.Printf("Using assets directory from flag: %s", flagValue)
		return flagValue
	}

	// 2. Try Bazel runfiles
	if s.opts.RunfilesMarker != "" && s.opts.WorkspaceSubpath != "" {
		if jsPath, err := runfiles.Rlocation(s.opts.RunfilesMarker); err == nil {
			// jsPath: /path/to/runfiles/webcad/web/poc/ui/main.js
			// RunfilesMarker: webcad/web/poc/ui/main.js
			// We want to find the root and append WorkspaceSubpath.
			
			// Normalize paths for comparison
			jsPathClean := filepath.Clean(jsPath)
			markerClean := filepath.Clean(s.opts.RunfilesMarker)
			
			// Strip the marker from the end of the resolved path
			if strings.HasSuffix(jsPathClean, markerClean) {
				runfilesRoot := jsPathClean[:len(jsPathClean)-len(markerClean)]
				// Workspace name is the first segment of the marker (e.g., "webcad")
				parts := strings.Split(markerClean, string(filepath.Separator))
				workspaceName := parts[0]
				
				assetDir := filepath.Join(runfilesRoot, workspaceName, s.opts.WorkspaceSubpath)
				log.Printf("Serving assets from Bazel runfiles: %s", assetDir)
				return assetDir
			}
		}
	}

	// 3. Try to locate workspace root via filesystem walk-up
	if wd, err := os.Getwd(); err == nil {
		if root, err := findWorkspaceRoot(wd); err == nil {
			assetDir := filepath.Join(root, s.opts.WorkspaceSubpath)
			log.Printf("Located workspace root, serving assets from: %s", assetDir)
			return assetDir
		}
	}

	// 4. Fallback to current working directory
	wd, _ := os.Getwd()
	log.Printf("Fallback: serving assets from current working directory: %s", wd)
	return wd
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
