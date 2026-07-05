package constraints

import (
	"fmt"
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

type VerticalDistanceEvaluator struct {
	p1, p2 gcstypes.EntityID
	value  float64
}

func NewVerticalDistanceEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*VerticalDistanceEvaluator, error) {
	v := c.GetVerticalDistance()
	idA := gcstypes.EntityID(v.GetEntityA())
	idB := gcstypes.EntityID(v.GetEntityB())

	resolvedA, err := resolvePointOrCenter(idA, entities)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve entity A: %w", err)
	}
	resolvedB, err := resolvePointOrCenter(idB, entities)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve entity B: %w", err)
	}

	return &VerticalDistanceEvaluator{p1: resolvedA, p2: resolvedB, value: v.GetValue()}, nil
}

func (v *VerticalDistanceEvaluator) NumEquations() int {
	return 1
}

func (v *VerticalDistanceEvaluator) EvaluateJacobian(x []float64, residuals []float64, J *mat.Dense, rowOffset int, paramIndices map[gcstypes.EntityID]int) {
	idx1, ok1 := paramIndices[v.p1]
	idx2, ok2 := paramIndices[v.p2]
	if !ok1 || !ok2 {
		return
	}

	y1 := x[idx1+1]
	y2 := x[idx2+1]

	residuals[0] = (y1-y2)*(y1-y2) - v.value*v.value

	if J != nil {
		J.Set(rowOffset, idx1+1, 2.0*(y1-y2))
		J.Set(rowOffset, idx2+1, -2.0*(y1-y2))
	}
}

func (v *VerticalDistanceEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	idx1, ok1 := paramIndices[v.p1]
	idx2, ok2 := paramIndices[v.p2]
	if !ok1 || !ok2 {
		return 0.0
	}

	y1 := x[idx1+1]
	y2 := x[idx2+1]

	r := (y1-y2)*(y1-y2) - v.value*v.value
	if grad != nil {
		factor := 4.0 * r * (y1 - y2)
		grad[idx1+1] += factor
		grad[idx2+1] -= factor
	}
	return r * r
}
