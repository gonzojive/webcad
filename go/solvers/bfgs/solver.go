// Package bfgs implements a webcad solver using the Gonum optimize package.
// It translates geometric entities and constraints into a continuous
// optimization problem and minimizes the sum of squared constraint residuals.
package bfgs

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gonzojive/webcad/go/solvers/core"
	"github.com/gonzojive/webcad/proto"

	"gonum.org/v1/gonum/optimize"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
)

// Solver implements core.Solver using gonum/optimize.
type Solver struct {
	NumericalGradients bool
}

// New returns a new Gonum-based solver with analytical gradients by default.
func New() *Solver {
	return &Solver{NumericalGradients: false}
}

// NewNumerical returns a new Gonum-based solver using numerical gradients (finite differences).
func NewNumerical() *Solver {
	return &Solver{NumericalGradients: true}
}

// ID returns the unique identifier of this solver.
func (s *Solver) ID() gcstypes.SolverID {
	if s.NumericalGradients {
		return "bfgs_numerical"
	}
	return "bfgs_analytical"
}

// Solve solves the given sketch starting from the current state of its entities.
// It updates the sketch with the solved parameters and returns a SolveResult.
func (s *Solver) Solve(sketch *schema.Sketch) (*schema.SolveResult, error) {
	start := time.Now()
	optResult, err := s.solve(sketch)
	duration := time.Since(start)

	result := &schema.SolveResult{
		SketchId:   sketch.Id,
		SolverName: string(s.ID()),
		SolveTime:  durationpb.New(duration),
		Success:    err == nil,
	}
	if err != nil {
		result.ErrorMessage = err.Error()
	} else if optResult != nil {
		result.Telemetry = &schema.SolverTelemetry{
			Iterations:      int32(optResult.Stats.MajorIterations),
			FuncEvaluations: int32(optResult.Stats.FuncEvaluations),
			GradEvaluations: int32(optResult.Stats.GradEvaluations),
			FinalResidual:   optResult.Location.F,
		}
	}

	s.populateSolvedState(result, sketch)
	return result, nil
}

// solve sets up and executes the BFGS optimization for a given sketch.
//
// This method:
//  1. Initializes a ConstraintSystem to map the sketch entities to a parameter vector
//     and build the mathematical objective function.
//  2. Extracts the active (non-fixed) variables as the optimization vector.
//  3. Checks if the system is already solved (residual below 1e-12).
//  4. Configures the optimize.Problem with the objective function and gradient.
//     - If s.NumericalGradients is true, it uses a central difference numerical gradient.
//     - Otherwise, it uses the analytical gradients provided by the GCS core.
//  5. Configures optimize.Settings with strict convergence criteria.
//  6. Runs the optimization using the BFGS quasi-Newton method.
//  7. Updates the sketch entities with the optimized parameter values.
//
// Parameters:
//   sketch: The input schema.Sketch containing the entities and constraints to solve.
//           The entities in this sketch will be updated in-place with the solved state.
//
// Returns:
//   *optimize.Result: The result structure from Gonum containing final objective value,
//                     parameters, and execution statistics.
func (s *Solver) solve(sketch *schema.Sketch) (*optimize.Result, error) {
	// Initialize the new ConstraintSystem
	sys, err := core.NewConstraintSystem(sketch)
	if err != nil {
		return nil, err
	}
	initialX := sys.ExtractVariables()

	if len(initialX) == 0 {
		return nil, errors.New("no optimizable entities found")
	}

	// Check if the initial state is already solved.
	initialObj := sys.Objective(initialX)
	if initialObj < 1e-12 {
		sys.UpdateSketch(initialX)
		return &optimize.Result{
			Location: optimize.Location{F: initialObj},
		}, nil
	}

	// Configure the problem with analytical or numerical Grad.
	problem := optimize.Problem{
		Func: sys.Objective,
	}
	if s.NumericalGradients {
		problem.Grad = func(grad, x []float64) {
			h := 1e-6
			for i := range x {
				temp := x[i]
				x[i] = temp - h
				fMinus := sys.Objective(x)
				x[i] = temp + h
				fPlus := sys.Objective(x)
				x[i] = temp
				grad[i] = (fPlus - fMinus) / (2.0 * h)
			}
		}
	} else {
		problem.Grad = sys.ObjectiveGradient
	}

	// Configure settings to ensure we converge to a very high precision.
	settings := &optimize.Settings{
		InitValues: &optimize.Location{
			F: initialObj,
		},
		Converger: &optimize.FunctionConverge{
			Absolute:   1e-12, // Tighter than default 1e-10
			Iterations: 200,   // Allow more iterations to find the true minimum
		},
	}

	// Use BFGS (quasi-Newton) for fast, superlinear local convergence.
	method := &optimize.BFGS{}

	result, err := runOptimization(problem, initialX, settings, method)
	if err != nil {
		return nil, err
	}

	sys.UpdateSketch(result.X)
	return result, nil
}

// runOptimization executes the Gonum minimization process and handles solver-specific errors.
//
// It calls optimize.Minimize to run the optimization algorithm. It includes custom error
// handling to tolerate linesearch failures if the final residual is already very small
// (under 1e-8), which can happen when the solver converges to a valid solution but cannot
// satisfy the linesearch's strict descent conditions at the very end.
//
// Parameters:
//   problem:  The optimize.Problem definition containing the objective function and gradient.
//   initialX: The starting parameter vector for the optimization.
//   settings: Tuning parameters for the optimizer (tolerances, iteration limits).
//   method:   The optimization algorithm to use (e.g., &optimize.BFGS{}).
//
// Returns:
//   *optimize.Result: The final optimization result (or nil on failure).
func runOptimization(problem optimize.Problem, initialX []float64, settings *optimize.Settings, method optimize.Method) (*optimize.Result, error) {
	result, err := optimize.Minimize(problem, initialX, settings, method)
	if err != nil {
		// If it's a linesearch failure, we might still have a good enough result.
		if result != nil && strings.Contains(err.Error(), "linesearch") {
			if result.F < 1e-8 {
				return result, nil
			}
		}
		return nil, fmt.Errorf("optimization failed: %w", err)
	}

	if err := result.Status.Err(); err != nil {
		// Tolerate linesearch failure if the residual is already acceptable.
		if strings.Contains(err.Error(), "linesearch") {
			if result.F < 1e-8 {
				return result, nil
			}
		}
		return nil, fmt.Errorf("optimization did not converge: %w", err)
	}
	return result, nil
}

func (s *Solver) populateSolvedState(result *schema.SolveResult, sketch *schema.Sketch) {
	if !result.Success {
		return
	}
	result.SolvedState = &schema.StateSnapshot{
		Entities: make(map[string]*schema.Entity),
	}
	for _, ent := range sketch.Entities {
		result.SolvedState.Entities[ent.Id] = proto.Clone(ent).(*schema.Entity)
	}
}
