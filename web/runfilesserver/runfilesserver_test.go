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

	// Test non-absolute path rejection (400 Bad Request)
	t.Run("Reject relative path in request", func(t *testing.T) {
		req := httptest.NewRequest("GET", "http://localhost:8080/ui/app.js", nil)
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
}

func TestRunfilesServer_Fallback(t *testing.T) {
	fallbackCalled := false
	var capturedPath string
	
	mockFallback := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fallbackCalled = true
		capturedPath = r.URL.Path
		w.WriteHeader(http.StatusTeapot) // distinct status to verify it was called
		_, _ = w.Write([]byte("fallback response"))
	})

	// Configure server pointing to a nonexistent workspace name to force runfiles resolution to fail,
	// which should trigger the fallback handler.
	handler := New(
		"nonexistent_workspace",
		"web/runfilesserver/testdata",
		"ui/index.html",
		mockFallback,
	)

	t.Run("Triggers fallback on missing runfile", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/ui/app.js", nil)
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
		if capturedPath != "/ui/app.js" {
			t.Errorf("expected fallback to receive path '/ui/app.js', got %q", capturedPath)
		}
		
		body, _ := io.ReadAll(resp.Body)
		if string(body) != "fallback response" {
			t.Errorf("expected fallback body 'fallback response', got %q", string(body))
		}
	})

	t.Run("Triggers fallback on root index redirect", func(t *testing.T) {
		fallbackCalled = false
		req := httptest.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		resp := w.Result()
		defer resp.Body.Close()

		if !fallbackCalled {
			t.Error("expected fallback handler to be called, but it was not")
		}
		// The path should have been rewritten to the indexHTML default by RunfilesServer
		if capturedPath != "/ui/index.html" {
			t.Errorf("expected fallback to receive index path '/ui/index.html', got %q", capturedPath)
		}
	})
}
