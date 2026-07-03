// Package main is the entrypoint for the webcad application.
package main

import "fmt"

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

func main() {
	fmt.Printf("Hello, %s!\n", DefaultAppName)
}
