package core

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"math"

	"github.com/gonzojive/webcad/go/solvers/core/constraints"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

// CalculateResiduals evaluates all constraints in the sketch against the current
// entity states (as defined by the parameter values stored in the sketch's entities).
// It returns a map of constraint ID to its absolute residual error.
// This is used for verifying solver correctness and providing telemetry.
func CalculateResiduals(sketch *schema.Sketch) (map[gcstypes.ConstraintID]constraints.ConstraintResidual, error) {
	residuals := make(map[gcstypes.ConstraintID]constraints.ConstraintResidual)
	if sketch == nil {
		return residuals, nil
	}

	sys, err := NewConstraintSystem(sketch)
	if err != nil {
		return nil, err
	}
	x := sys.initialX

	for _, ce := range sys.evaluators {
		valSq := ce.eval.Evaluate(x, nil, sys.paramIndexMap)
		residuals[ce.id] = constraints.ConstraintResidual(math.Sqrt(valSq))
	}

	return residuals, nil
}

// MaxResidual returns the maximum absolute residual error across all constraints in the sketch,
// evaluating them at the current entity states.
func MaxResidual(sketch *schema.Sketch) (constraints.ConstraintResidual, error) {
	residuals, err := CalculateResiduals(sketch)
	if err != nil {
		return 0, err
	}
	maxRes := constraints.ConstraintResidual(0.0)
	for _, res := range residuals {
		if res > maxRes {
			maxRes = res
		}
	}
	return maxRes, nil
}

// CalculateConstraintResidual computes the absolute residual error for a single constraint,
// evaluating it at the current states of the entities in the sketch.
func CalculateConstraintResidual(c *schema.Constraint, sketch *schema.Sketch, entityMap map[gcstypes.EntityID]*schema.Entity) (constraints.ConstraintResidual, error) {
	sys, err := NewConstraintSystem(sketch)
	if err != nil {
		return 0, err
	}
	x := sys.initialX
	
	// Use construction-time entities to define the constraint's targets/chiralities
	constEntities := getConstructionEntities(sketch)
	eval, err := constraints.NewEvaluator(c, constEntities)
	if err != nil {
		return 0, err
	}
	valSq := eval.Evaluate(x, nil, sys.paramIndexMap)
	return constraints.ConstraintResidual(math.Sqrt(valSq)), nil
}

type constraintEvaluator struct {
	id   gcstypes.ConstraintID
	eval constraints.Evaluator
}

// ConstraintSystem maps a Sketch to a flat optimization parameter vector x and
// computes its analytical residuals, Jacobians, and objective gradients.
//
// The parameter vector x contains all degrees of freedom of the sketch's entities
// (e.g. coordinates of points, radii of circles) flattened into a single slice.
type ConstraintSystem struct {
	sketch        *schema.Sketch
	paramIndexMap map[gcstypes.EntityID]int
	paramCountMap map[gcstypes.EntityID]int
	entityMap     map[gcstypes.EntityID]*schema.Entity
	initialX      []float64
	numVars       int
	evaluators    []constraintEvaluator
}

// NewConstraintSystem creates a new ConstraintSystem from a sketch.
func NewConstraintSystem(sketch *schema.Sketch) (*ConstraintSystem, error) {
	var initialX []float64
	paramIndexMap := make(map[gcstypes.EntityID]int)
	paramCountMap := make(map[gcstypes.EntityID]int)
	entityMap := make(map[gcstypes.EntityID]*schema.Entity)

	for _, entity := range sketch.Entities {
		entID := gcstypes.EntityID(entity.Id)
		entityMap[entID] = entity
		params := GetParams(entity)
		if params == nil {
			continue
		}
		paramIndexMap[entID] = len(initialX)
		paramCountMap[entID] = len(params)
		initialX = append(initialX, params...)
	}

	// Use initial state if available to lock targets, chiralities, and normalization factors
	constEntities := getConstructionEntities(sketch)

	// Construct evaluators
	evaluators := make([]constraintEvaluator, 0, len(sketch.Constraints))
	for _, c := range sketch.Constraints {
		eval, err := constraints.NewEvaluator(c, constEntities)
		if err != nil {
			return nil, fmt.Errorf("failed to create evaluator for constraint %s (%T): %w", c.Id, c.GetConstraintType(), err)
		}
		evaluators = append(evaluators, constraintEvaluator{
			id:   gcstypes.ConstraintID(c.Id),
			eval: eval,
		})
	}

	sys := &ConstraintSystem{
		sketch:        sketch,
		paramIndexMap: paramIndexMap,
		paramCountMap: paramCountMap,
		entityMap:     entityMap,
		initialX:      initialX,
		numVars:       len(initialX),
		evaluators:    evaluators,
	}

	return sys, nil
}

// getConstructionEntities returns the initial state entities if available,
// falling back to the current sketch entities.
func getConstructionEntities(sketch *schema.Sketch) map[gcstypes.EntityID]*schema.Entity {
	if sketch.InitialState != nil && len(sketch.InitialState.Entities) > 0 {
		m := make(map[gcstypes.EntityID]*schema.Entity)
		for id, ent := range sketch.InitialState.Entities {
			m[gcstypes.EntityID(id)] = ent
		}
		return m
	}
	entityMap := make(map[gcstypes.EntityID]*schema.Entity)
	for _, ent := range sketch.Entities {
		entityMap[gcstypes.EntityID(ent.Id)] = ent
	}
	return entityMap
}

// NumVars returns the total number of parameters (variables) in the optimization vector.
func (sys *ConstraintSystem) NumVars() int {
	return sys.numVars
}

// InitialX returns a copy of the initial parameter vector (the flat vector x representing
// the initial states of the sketch entities).
func (sys *ConstraintSystem) InitialX() []float64 {
	x := make([]float64, len(sys.initialX))
	copy(x, sys.initialX)
	return x
}

// ExtractVariables extracts the current parameters of all entities into a flat slice x.
// This serves as the starting parameter vector (initial guess) for the optimization.
func (sys *ConstraintSystem) ExtractVariables() []float64 {
	x := make([]float64, sys.numVars)
	for id, idx := range sys.paramIndexMap {
		count := sys.paramCountMap[id]
		ent := sys.entityMap[id]
		copy(x[idx:idx+count], GetParams(ent))
	}
	return x
}

// UpdateSketch updates the sketch entities with the values from a flat parameter vector x.
// This writes the optimized values back to the structured sketch.
func (sys *ConstraintSystem) UpdateSketch(x []float64) {
	for id, idx := range sys.paramIndexMap {
		count := sys.paramCountMap[id]
		ent := sys.entityMap[id]
		SetParams(ent, x[idx:idx+count])
	}
}

// Objective evaluates the sum of squared residuals: E(x) = sum_i r_i(x)^2.
//
// E(x) is the scalar function minimized by the solver.
func (sys *ConstraintSystem) Objective(x []float64) float64 {
	return sys.evaluate(x, nil)
}

// ObjectiveGradient evaluates the gradient of the objective: grad = 2 * sum_i r_i(x) * grad(r_i(x)).
func (sys *ConstraintSystem) ObjectiveGradient(grad, x []float64) {
	sys.evaluate(x, grad)
}

// evaluate performs the actual computation of the objective value and/or its gradient.
// If grad is not nil, it accumulates the gradient into it.
// This single-pass implementation ensures zero heap allocations.
func (sys *ConstraintSystem) evaluate(x []float64, grad []float64) float64 {
	if grad != nil {
		for i := range grad {
			grad[i] = 0.0
		}
	}
	totalResidualSq := 0.0

	for _, ce := range sys.evaluators {
		totalResidualSq += ce.eval.Evaluate(x, grad, sys.paramIndexMap)
	}

	return totalResidualSq
}

// NumEquations returns the total number of independent scalar equations across all constraints.
func (sys *ConstraintSystem) NumEquations() int {
	m := 0
	for _, ce := range sys.evaluators {
		if je, ok := ce.eval.(constraints.JacobianEvaluator); ok {
			m += je.NumEquations()
		}
	}
	return m
}

// EvaluateJacobian evaluates the unsquared residuals directly into the residuals slice,
// and writes the Jacobian rows into J. If J is nil, only residuals are evaluated.
func (sys *ConstraintSystem) EvaluateJacobian(x []float64, residuals []float64, J *mat.Dense) {
	if J != nil {
		J.Zero() // Guarantee a clean matrix at the start of evaluation
	}
	rowOffset := 0
	for _, ce := range sys.evaluators {
		if je, ok := ce.eval.(constraints.JacobianEvaluator); ok {
			eqs := je.NumEquations()
			subRes := residuals[rowOffset : rowOffset+eqs]
			je.EvaluateJacobian(x, subRes, J, rowOffset, sys.paramIndexMap)
			rowOffset += eqs
		}
	}
}

// EvaluateResiduals evaluates and concatenates all residuals into the pre-allocated res slice.
func (sys *ConstraintSystem) EvaluateResiduals(x []float64, res []float64) {
	sys.EvaluateJacobian(x, res, nil)
}
