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
	handler := New(
		"webcad",
		"web/runfilesserver/testdata",
		"ui/index.html",
		nil,
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
		"webcad",
		"web/runfilesserver/testdata",
		"ui/index.html",
		nil,
	)

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
		"webcad",
		"web/runfilesserver/testdata",
		"ui/index.html",
		nil,
	)
	handler.SetLocalOverrideDir(tempDir)

	tests := []struct {
		name           string
		path           string
		expectedStatus int
		expectedBody   string
	}{
		{
			name:           "Serve file from override",
			path:           "/test.txt",
			expectedStatus: http.StatusOK,
			expectedBody:   expectedContent,
		},
		{
			name:           "404 for missing file in override",
			path:           "/missing.txt",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "Override directory traversal blocked (Cleaned to root)",
			path:           "/../escaped.txt",
			expectedStatus: http.StatusNotFound, // cleaned to /escaped.txt, which doesn't exist
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "http://localhost:8080/fallback", nil)
			req.URL.Path = tc.path
			
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
				if string(bodyBytes) != tc.expectedBody {
					t.Errorf("expected body %q, got %q", tc.expectedBody, string(bodyBytes))
				}
			}
		})
	}
}

func TestRunfilesServer_Fallback(t *testing.T) {
	tests := []struct {
		name           string
		path           string
		expectedPath   string // what path fallback should receive
	}{
		{
			name:         "Triggers fallback on missing runfile",
			path:         "/ui/app.js",
			expectedPath: "/ui/app.js",
		},
		{
			name:         "Triggers fallback on root index redirect",
			path:         "/",
			expectedPath: "/ui/index.html",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fallbackCalled := false
			var capturedPath string
			
			mockFallback := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fallbackCalled = true
				capturedPath = r.URL.Path
				w.WriteHeader(http.StatusTeapot)
				_, _ = w.Write([]byte("fallback response"))
			})

			handler := New(
				"nonexistent_workspace",
				"web/runfilesserver/testdata",
				"ui/index.html",
				mockFallback,
			)

			req := httptest.NewRequest("GET", tc.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			resp := w.Result()
			defer resp.Body.Close()

			if !fallbackCalled {
				t.Error("expected fallback handler to be called, but it was not")
			}
			if resp.StatusCode != http.StatusTeapot {
				t.Errorf("expected status from fallback handler %d, got %d", http.StatusTeapot, resp.StatusCode)
			}
			if capturedPath != tc.expectedPath {
				t.Errorf("expected fallback to receive path %q, got %q", tc.expectedPath, capturedPath)
			}
			
			if tc.path == "/ui/app.js" {
				body, _ := io.ReadAll(resp.Body)
				if string(body) != "fallback response" {
					t.Errorf("expected fallback body 'fallback response', got %q", string(body))
				}
			}
		})
	}
}
