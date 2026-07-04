package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"math"

	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

type fixedTarget struct {
	id            gcstypes.EntityID
	initialValues []float64
}

// FixedEvaluator evaluates fixed constraints, pinning an entity's parameters to their initial values.
type FixedEvaluator struct {
	targets []fixedTarget
}

// NewFixedEvaluator creates a new FixedEvaluator for the given constraint.
func NewFixedEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*FixedEvaluator, error) {
	fixed := c.GetFixed()
	entID := gcstypes.EntityID(fixed.GetEntityId())
	ent, ok := entities[entID]
	if !ok {
		return nil, fmt.Errorf("entity %s not found", entID)
	}

	var targets []fixedTarget
	if isLine(ent) {
		p1Id, p2Id, p1, p2, err := getLinePoints(ent, entities)
		if err != nil {
			return nil, fmt.Errorf("line endpoints unresolved: %w", err)
		}
		targets = append(targets, fixedTarget{id: p1Id, initialValues: []float64{p1.X, p1.Y}})
		targets = append(targets, fixedTarget{id: p2Id, initialValues: []float64{p2.X, p2.Y}})
	} else {
		params := getParams(ent)
		if params == nil {
			return nil, fmt.Errorf("failed to get params for entity %s", entID)
		}
		initialValues := make([]float64, len(params))
		copy(initialValues, params)
		targets = append(targets, fixedTarget{id: entID, initialValues: initialValues})
	}

	return &FixedEvaluator{
		targets: targets,
	}, nil
}

// Evaluate computes the squared residual and accumulates the gradient.
func (f *FixedEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	const weightSq = 1000.0
	totalResidualSq := 0.0

	for _, target := range f.targets {
		idx, ok := paramIndices[target.id]
		if !ok {
			continue
		}
		count := len(target.initialValues)
		for i := 0; i < count; i++ {
			diff := x[idx+i] - target.initialValues[i]
			totalResidualSq += weightSq * diff * diff
			if grad != nil {
				grad[idx+i] += 2.0 * weightSq * diff
			}
		}
	}
	return totalResidualSq
}

// NumEquations returns the number of equations (equal to the number of parameters of the entity).
func (f *FixedEvaluator) NumEquations() int {
	n := 0
	for _, t := range f.targets {
		n += len(t.initialValues)
	}
	return n
}

// EvaluateJacobian evaluates the unsquared residuals and writes them to J.
func (f *FixedEvaluator) EvaluateJacobian(x []float64, residuals []float64, J *mat.Dense, rowOffset int, paramIndices map[gcstypes.EntityID]int) {
	const weightSq = 1000.0
	sqrtW := math.Sqrt(weightSq)

	localEq := 0
	for _, target := range f.targets {
		idx, ok := paramIndices[target.id]
		if !ok {
			continue
		}
		count := len(target.initialValues)
		for i := 0; i < count; i++ {
			diff := x[idx+i] - target.initialValues[i]
			residuals[localEq] = sqrtW * diff
			if J != nil {
				J.Set(rowOffset+localEq, idx+i, sqrtW)
			}
			localEq++
		}
	}
}
