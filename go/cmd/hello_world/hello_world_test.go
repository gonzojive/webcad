// Package main contains tests for the webcad entrypoint.
package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestAppName(t *testing.T) {
	expected := "webcad"
	if DefaultAppName.String() != expected {
		t.Errorf("expected %q, got %q", expected, DefaultAppName.String())
	}
}

func TestServerRouting(t *testing.T) {
	// Create dummy files to serve.
	tmpDir := t.TempDir()
	indexFile := filepath.Join(tmpDir, "index.html")
	bundleFile := filepath.Join(tmpDir, "bundle.js")

	if err := os.WriteFile(indexFile, []byte("HTML Content"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bundleFile, []byte("JS Content"), 0644); err != nil {
		t.Fatal(err)
	}

	mux := newMux(indexFile, bundleFile)

	tests := []struct {
		path         string
		expectedBody string
		expectedCode int
	}{
		{"/", "HTML Content", http.StatusOK},
		{"/index.html", "", http.StatusMovedPermanently},
		{"/bundle.js", "JS Content", http.StatusOK},
		{"/invalid", "404 page not found\n", http.StatusNotFound},
	}

	for _, tc := range tests {
		req := httptest.NewRequest("GET", tc.path, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != tc.expectedCode {
			t.Errorf("path %s: expected status %d, got %d", tc.path, tc.expectedCode, w.Code)
		}
		if w.Body.String() != tc.expectedBody {
			t.Errorf("path %s: expected body %q, got %q", tc.path, tc.expectedBody, w.Body.String())
		}
	}
}
