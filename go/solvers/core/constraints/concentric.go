package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

// ConcentricEvaluator evaluates concentric constraints between circles, arcs, ellipses, or points.
type ConcentricEvaluator struct {
	idA, idB gcstypes.EntityID
}

// NewConcentricEvaluator creates a new ConcentricEvaluator for the given constraint.
func NewConcentricEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*ConcentricEvaluator, error) {
	cc := c.GetConcentric()
	idA := gcstypes.EntityID(cc.GetEntityA())
	idB := gcstypes.EntityID(cc.GetEntityB())
	if idA == idB {
		return nil, fmt.Errorf("concentric constraint cannot be applied to the same entity %s", idA)
	}
	resolvedA, err := resolvePointOrCenter(idA, entities)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve entity A: %w", err)
	}
	resolvedB, err := resolvePointOrCenter(idB, entities)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve entity B: %w", err)
	}
	return &ConcentricEvaluator{
		idA: resolvedA,
		idB: resolvedB,
	}, nil
}

// Evaluate computes the squared residual and accumulates the gradient.
func (c *ConcentricEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	idx1, ok1 := paramIndices[c.idA]
	idx2, ok2 := paramIndices[c.idB]
	if !ok1 || !ok2 {
		return 0.0
	}

	// Centers are at x[idx] and x[idx+1] for Point, Circle, Arc, and Ellipse
	dx := x[idx1] - x[idx2]
	dy := x[idx1+1] - x[idx2+1]
	totalResidualSq := dx*dx + dy*dy

	if grad != nil {
		grad[idx1] += 2.0 * dx
		grad[idx1+1] += 2.0 * dy
		grad[idx2] -= 2.0 * dx
		grad[idx2+1] -= 2.0 * dy
	}
	return totalResidualSq
}

// NumEquations returns the number of equations (2).
func (c *ConcentricEvaluator) NumEquations() int {
	return 2
}

// EvaluateJacobian evaluates the unsquared residuals and writes them to J.
func (c *ConcentricEvaluator) EvaluateJacobian(x []float64, residuals []float64, J *mat.Dense, rowOffset int, paramIndices map[gcstypes.EntityID]int) {
	idx1, ok1 := paramIndices[c.idA]
	idx2, ok2 := paramIndices[c.idB]
	if !ok1 || !ok2 {
		return
	}

	dx := x[idx1] - x[idx2]
	dy := x[idx1+1] - x[idx2+1]

	residuals[0] = dx
	residuals[1] = dy

	if J != nil {
		// Row 0: r_0 = x_1 - x_2
		J.Set(rowOffset, idx1, 1.0)
		J.Set(rowOffset, idx2, -1.0)

		// Row 1: r_1 = y_1 - y_2
		J.Set(rowOffset+1, idx1+1, 1.0)
		J.Set(rowOffset+1, idx2+1, -1.0)
	}
}
