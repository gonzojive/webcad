package runfilesserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunfilesServer(t *testing.T) {
	// Configure the server pointing to our testdata (no fallback)
	handler, err := New(
		"webcad/web/runfilesserver/testdata",
		"",
	)
	if err != nil {
		t.Fatalf("failed to initialize handler: %v", err)
	}

	tests := []struct {
		name           string
		path           string
		expectedStatus int
		expectedBody   string
		expectedMime   string
		expectedLoc    string // for redirects
	}{
		{
			name:           "404 for root index (no index.html at root)",
			path:           "/",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "Serve Index at /ui/",
			path:           "/ui/",
			expectedStatus: http.StatusOK,
			expectedBody:   "Test Index Content",
			expectedMime:   "text/html",
		},
		{
			name:           "Redirect /ui to /ui/",
			path:           "/ui",
			expectedStatus: http.StatusMovedPermanently,
			expectedLoc:    "ui/",
		},
		{
			name:           "Serve JS file",
			path:           "/ui/app.js",
			expectedStatus: http.StatusOK,
			expectedBody:   "console.log(\"test app\");",
			expectedMime:   "application/javascript",
		},
		{
			name:           "Serve WASM file",
			path:           "/solver/dummy.wasm",
			expectedStatus: http.StatusOK,
			expectedBody:   "\\x00asm\\x01\\x00\\x00\\x00",
			expectedMime:   "application/wasm",
		},
		{
			name:           "404 for missing file",
			path:           "/ui/missing.js",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "404 for file outside subpath (blocked logically)",
			path:           "/../runfilesserver.go", // Cleaned to /runfilesserver.go, not found
			expectedStatus: http.StatusNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tc.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			resp := w.Result()
			defer resp.Body.Close()

			if resp.StatusCode != tc.expectedStatus {
				t.Errorf("expected status %d, got %d", tc.expectedStatus, resp.StatusCode)
			}

			if tc.expectedStatus == http.StatusMovedPermanently {
				loc := resp.Header.Get("Location")
				if loc != tc.expectedLoc {
					t.Errorf("expected redirect location %q, got %q", tc.expectedLoc, loc)
				}
			}

			if tc.expectedStatus == http.StatusOK {
				bodyBytes, err := io.ReadAll(resp.Body)
				if err != nil {
					t.Fatalf("failed to read body: %v", err)
				}
				bodyStr := string(bodyBytes)
				if !strings.Contains(bodyStr, tc.expectedBody) {
					t.Errorf("expected body to contain %q, got %q", tc.expectedBody, bodyStr)
				}
				
				contentType := resp.Header.Get("Content-Type")
				if !strings.HasPrefix(contentType, tc.expectedMime) {
					t.Errorf("expected Content-Type starting with %q, got %q", tc.expectedMime, contentType)
				}
			}
		})
	}
}

func TestRunfilesServer_Security(t *testing.T) {
	handler, err := New(
		"webcad/web/runfilesserver/testdata",
		"",
	)
	if err != nil {
		t.Fatalf("failed to initialize handler: %v", err)
	}

	tests := []struct {
		name           string
		path           string // raw path to inject
		expectedStatus int
	}{
		{
			name:           "Reject relative path in request",
			path:           "../runfilesserver.go",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Reject empty path",
			path:           "",
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "http://localhost:8080/ui/app.js", nil)
			req.URL.Path = tc.path
			
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			resp := w.Result()
			if resp.StatusCode != tc.expectedStatus {
				t.Errorf("expected status %d, got %d", tc.expectedStatus, resp.StatusCode)
			}
		})
	}
}

func TestRunfilesServer_Fallback(t *testing.T) {
	// Create a temp directory to act as the fallback workspace folder
	tempDir, err := os.MkdirTemp("", "runfiles_fallback_test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Write mock local fallback files mimicking the testdata layout
	err = os.MkdirAll(filepath.Join(tempDir, "ui"), 0755)
	if err != nil {
		t.Fatalf("failed to create ui dir: %v", err)
	}
	fallbackIndexContent := "Local Fallback Index Content"
	err = os.WriteFile(filepath.Join(tempDir, "ui", "index.html"), []byte(fallbackIndexContent), 0644)
	if err != nil {
		t.Fatalf("failed to write fallback index: %v", err)
	}
	fallbackJSContent := "console.log(\"local fallback app\");"
	err = os.WriteFile(filepath.Join(tempDir, "ui", "app.js"), []byte(fallbackJSContent), 0644)
	if err != nil {
		t.Fatalf("failed to write fallback js: %v", err)
	}

	// Initialize server pointing to a nonexistent workspace runfiles root (forcing fallback)
	handler, err := New(
		"nonexistent_workspace/web/runfilesserver/testdata",
		tempDir,
	)
	if err != nil {
		t.Fatalf("failed to initialize handler: %v", err)
	}

	tests := []struct {
		name           string
		path           string
		expectedStatus int
		expectedBody   string
		expectedMime   string
		expectedLoc    string
	}{
		{
			name:           "Serve file from fallback",
			path:           "/ui/app.js",
			expectedStatus: http.StatusOK,
			expectedBody:   fallbackJSContent,
			expectedMime:   "application/javascript",
		},
		{
			name:           "Serve Index from fallback at /ui/",
			path:           "/ui/",
			expectedStatus: http.StatusOK,
			expectedBody:   fallbackIndexContent,
			expectedMime:   "text/html",
		},
		{
			name:           "Redirect /ui to /ui/ via fallback resolution",
			path:           "/ui",
			expectedStatus: http.StatusMovedPermanently,
			expectedLoc:    "ui/",
		},
		{
			name:           "404 for missing file in fallback",
			path:           "/ui/missing.js",
			expectedStatus: http.StatusNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tc.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			resp := w.Result()
			defer resp.Body.Close()

			if resp.StatusCode != tc.expectedStatus {
				t.Errorf("expected status %d, got %d", tc.expectedStatus, resp.StatusCode)
			}

			if tc.expectedStatus == http.StatusMovedPermanently {
				loc := resp.Header.Get("Location")
				if loc != tc.expectedLoc {
					t.Errorf("expected redirect location %q, got %q", tc.expectedLoc, loc)
				}
			}

			if tc.expectedStatus == http.StatusOK {
				bodyBytes, err := io.ReadAll(resp.Body)
				if err != nil {
					t.Fatalf("failed to read body: %v", err)
				}
				bodyStr := string(bodyBytes)
				if !strings.Contains(bodyStr, tc.expectedBody) {
					t.Errorf("expected body to contain %q, got %q", tc.expectedBody, bodyStr)
				}
				
				contentType := resp.Header.Get("Content-Type")
				if !strings.HasPrefix(contentType, tc.expectedMime) {
					t.Errorf("expected Content-Type starting with %q, got %q", tc.expectedMime, contentType)
				}
			}
		})
	}
}
