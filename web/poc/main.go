// Program poc is a web server that serves WebCAD frontend assets and hosts API endpoints.
package main

import (
	"log"

	"github.com/gonzojive/webcad/web/server"
)

func main() {
	s := server.New(server.Options{
		DefaultAddr:      ":8080",
		WorkspaceName:    "webcad",
		WorkspaceSubpath: "web/poc",
	})

	if err := s.Start(); err != nil {
		log.Fatal(err)
	}
}
