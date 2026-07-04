package runfilesserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunfilesServer(t *testing.T) {
	// Configure the server pointing to our testdata (no fallback)
	handler := New(
		"webcad/web/runfilesserver/testdata",
		nil,
	)

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
			expectedLoc:    "/ui/",
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
	handler := New(
		"webcad/web/runfilesserver/testdata",
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

func TestRunfilesServer_Fallback(t *testing.T) {
	tests := []struct {
		name           string
		path           string
		expectedPath   string // what path fallback should receive
		expectedStatus int
	}{
		{
			name:           "Triggers fallback on missing runfile",
			path:           "/ui/app.js",
			expectedPath:   "/ui/app.js",
			expectedStatus: http.StatusTeapot,
		},
		{
			name:           "Triggers fallback on root directory",
			path:           "/ui/",
			expectedPath:   "/ui/",
			expectedStatus: http.StatusTeapot,
		},
		{
			name:           "Triggers fallback on directory missing slash (no redirect if missing runfiles)",
			path:           "/ui",
			expectedPath:   "/ui", // fallback receives the original requested path
			expectedStatus: http.StatusTeapot,
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
				"nonexistent_workspace/web/runfilesserver/testdata",
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
			if resp.StatusCode != tc.expectedStatus {
				t.Errorf("expected status %d, got %d", tc.expectedStatus, resp.StatusCode)
			}
			if capturedPath != tc.expectedPath {
				t.Errorf("expected fallback to receive path %q, got %q", tc.expectedPath, capturedPath)
			}
		})
	}
}
