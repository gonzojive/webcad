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
	// Configure the server pointing to our testdata
	// Marker: webcad/web/runfilesserver/testdata/ui/index.html
	// Subpath: web/runfilesserver/testdata
	handler := New(
		"webcad/web/runfilesserver/testdata/ui/index.html",
		"web/runfilesserver/testdata",
		"ui/index.html",
	)

	tests := []struct {
		name           string
		path           string
		expectedStatus int
		expectedBody   string
		expectedMime   string
	}{
		{
			name:           "Serve Index Fallback at root",
			path:           "/",
			expectedStatus: http.StatusOK,
			expectedBody:   "Test Index Content",
			expectedMime:   "text/html",
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
			expectedMime:   "text/plain",
		},
		{
			name:           "404 for file outside subpath (blocked logically)",
			path:           "/runfilesserver.go", // exists in workspace but not in testdata subpath
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
	handler := New(
		"webcad/web/runfilesserver/testdata/ui/index.html",
		"web/runfilesserver/testdata",
		"ui/index.html",
	)

	// Test non-absolute path rejection (400 Bad Request)
	t.Run("Reject relative path in request", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://localhost:8080/ui/app.js", nil)
		// Manually override URL Path to be relative (httptest.NewRequest might clean it, so we force it)
		req.URL.Path = "../runfilesserver.go"
		
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		resp := w.Result()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("expected status 400 for relative path, got %d", resp.StatusCode)
		}
	})
}

func TestRunfilesServer_LocalOverride(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "runfiles_override_test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Write a file in temp dir
	testFile := filepath.Join(tempDir, "test.txt")
	expectedContent := "override content"
	if err := os.WriteFile(testFile, []byte(expectedContent), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	handler := New(
		"webcad/web/runfilesserver/testdata/ui/index.html",
		"web/runfilesserver/testdata",
		"ui/index.html",
	)
	handler.SetLocalOverrideDir(tempDir)

	req := httptest.NewRequest("GET", "/test.txt", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("failed to read body: %v", err)
	}
	if string(bodyBytes) != expectedContent {
		t.Errorf("expected body %q, got %q", expectedContent, string(bodyBytes))
	}

	// Test directory traversal in override
	t.Run("Override directory traversal blocked", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/../escaped.txt", nil)
		// net/http will clean "/../" to "/" before calling handler in real life,
		// but we test that our handler prefix check blocks it if it reaches it.
		// httptest.NewRequest cleans it, so we force it.
		req.URL.Path = "/../escaped.txt"
		
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		resp := w.Result()
		// filepath.Clean("/../escaped.txt") -> "/escaped.txt".
		// Join(tempDir, "escaped.txt") is still inside tempDir (it doesn't escape physically).
		// So it returns 404 (since escaped.txt doesn't exist).
		// But if we tried to do "/../../something" (outside tempDir).
		// filepath.Clean("/../../something") -> "/something".
		// Join(tempDir, "something") is still inside tempDir.
		// It is physically impossible to escape tempDir using filepath.Join(tempDir, relPath)
		// if relPath has no ".." after Clean.
		// And relPath is strings.TrimPrefix(Clean(path), "/"), so it never starts with ".." or contains ".." that goes above root.
		// So it is always safe.
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", resp.StatusCode)
		}
	})
}
