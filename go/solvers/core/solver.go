package core

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"github.com/gonzojive/webcad/proto"
)

// Solver defines the interface that any constraint solver must implement.
//
// Implementations may delegate to external processes, use CGO wrapper,
// or be written purely in Go.
type Solver interface {
	// ID returns the unique identifier for this solver.
	// This ID should be consistent across runs and uniquely identify the
	// solver implementation (e.g., "lm", "bfgs").
	ID() gcstypes.SolverID

	// Solve solves the sketch starting from the current state of its entities.
	// It updates the sketch with the solved parameters and returns a SolveResult.
	Solve(sketch *schema.Sketch) (*schema.SolveResult, error)
}

