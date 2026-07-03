// Package main contains tests for the webcad entrypoint.
package main

import "testing"

func TestAppName(t *testing.T) {
	expected := "webcad"
	if DefaultAppName.String() != expected {
		t.Errorf("expected %q, got %q", expected, DefaultAppName.String())
	}
}
