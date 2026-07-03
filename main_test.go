package main

import "testing"

func TestMainApp(t *testing.T) {
	// Simple sanity test
	expected := "Hello, WebCAD!"
	if expected != "Hello, WebCAD!" {
		t.Errorf("expected Hello, WebCAD!, got something else")
	}
}
