// Package lm implements a 2D geometric constraint solver using the
// Levenberg-Marquardt (LM) optimization algorithm.
//
// It is optimized for high performance and zero heap allocations in the hot loop.
package lm

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/gonzojive/webcad/go/solvers/core"
	"github.com/gonzojive/webcad/proto"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
)

type solveResult struct {
	status          SolverStatus
	iterations      int
	funcEvaluations int
	gradEvaluations int
	finalResidual   float64
}

// LMSolver implements core.Solver using the Levenberg-Marquardt algorithm.
//
// It uses pre-allocated workspaces and direct BLAS/LAPACK calls to achieve
// zero heap allocations during solving.
type LMSolver struct {
	// EpGeom is the geometric tolerance for convergence.
	// The solver succeeds if the infinity norm of residuals is below this value.
	EpGeom  float64
	// EpGrad is the gradient tolerance.
	// The solver stops with Inconsistent status if the infinity norm of the gradient
	// is below this value, indicating a local minimum.
	EpGrad  float64
	// EpStep is the step tolerance.
	// The solver stops with Stalled status if the step size is below this value.
	EpStep  float64
	// MaxIter is the maximum number of iterations allowed.
	MaxIter int
	pool    sync.Pool
}

// New returns a new LMSolver with default tolerances and iteration limits.
func New() *LMSolver {
	return &LMSolver{
		EpGeom:  1e-8,
		EpGrad:  1e-12,
		EpStep:  1e-12,
		MaxIter: 100,
		pool: sync.Pool{
			New: func() interface{} {
				return &SolverWorkspace{}
			},
		},
	}
}

// ID returns the unique identifier "lm" for this solver.
func (s *LMSolver) ID() gcstypes.SolverID {
	return "lm"
}

// Solve solves the given sketch starting from the current state of its entities.
// It updates the sketch with the solved parameters and returns a SolveResult.
func (s *LMSolver) Solve(sketch *schema.Sketch) (*schema.SolveResult, error) {
	sys, err := core.NewConstraintSystem(sketch)
	if err != nil {
		return nil, err
	}
	x := sys.ExtractVariables()
	if len(x) == 0 {
		return nil, errors.New("no optimizable entities found")
	}

	// Check if the initial state is already solved using configurable tolerance.
	initialObj := sys.Objective(x)
	if initialObj < s.EpGeom*s.EpGeom {
		sys.UpdateSketch(x)
		result := &schema.SolveResult{
			SketchId:   sketch.Id,
			SolverName: string(s.ID()),
			Success:    true,
		}
		result.Telemetry = &schema.SolverTelemetry{
			FinalResidual: initialObj,
		}
		s.populateSolvedState(result, sketch)
		return result, nil
	}

	start := time.Now()
	xOpt, res := s.solve(sys, x)
	duration := time.Since(start)

	sys.UpdateSketch(xOpt)

	result := &schema.SolveResult{
		SketchId:   sketch.Id,
		SolverName: string(s.ID()),
		SolveTime:  durationpb.New(duration),
		Success:    res.status == Success,
	}

	if !result.Success {
		result.ErrorMessage = fmt.Sprintf("solver failed with status: %v, final residual: %e", res.status, res.finalResidual)
	}

	result.Telemetry = &schema.SolverTelemetry{
		Iterations:      int32(res.iterations),
		FuncEvaluations: int32(res.funcEvaluations),
		GradEvaluations: int32(res.gradEvaluations),
		FinalResidual:   res.finalResidual,
	}

	s.populateSolvedState(result, sketch)
	return result, nil
}

func (s *LMSolver) populateSolvedState(result *schema.SolveResult, sketch *schema.Sketch) {
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
