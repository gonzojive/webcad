// Package main is the entrypoint for the webcad application.
package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

// AppName is a domain-specific type representing the application name.
type AppName string

// String returns the string representation of [AppName].
func (a AppName) String() string {
	return string(a)
}

const (
	// DefaultAppName is the default name of the application.
	DefaultAppName AppName = "webcad"
)

// newMux returns a configured http.ServeMux that routes requests to index.html or the script bundle.
func newMux(indexPath, bundlePath string) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			http.ServeFile(w, r, indexPath)
			return
		}
		if r.URL.Path == "/bundle.js" {
			http.ServeFile(w, r, bundlePath)
			return
		}
		http.NotFound(w, r)
	})
	return mux
}

func main() {
	// Find index.html using runfiles.
	// Note: Runfile paths use the workspace name ("webcad") as the root directory prefix.
	indexPath, err := runfiles.Rlocation("webcad/frontend/src/index.html")
	if err != nil {
		log.Fatalf("could not find index.html: %v", err)
	}

	// Find bundle.js using runfiles
	bundlePath, err := runfiles.Rlocation("webcad/frontend/bundle.js")
	if err != nil {
		log.Fatalf("could not find bundle.js: %v", err)
	}

	port := 8080
	fmt.Printf("Hello, %s! Serving on http://localhost:%d\n", DefaultAppName, port)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", port), newMux(indexPath, bundlePath)))
}
