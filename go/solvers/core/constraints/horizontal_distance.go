package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

type HorizontalDistanceEvaluator struct {
	p1, p2 gcstypes.EntityID
	value  float64
}

func NewHorizontalDistanceEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*HorizontalDistanceEvaluator, error) {
	h := c.GetHorizontalDistance()
	idA := gcstypes.EntityID(h.GetEntityA())
	idB := gcstypes.EntityID(h.GetEntityB())
	
	if _, ok := entities[idA]; !ok {
		return nil, fmt.Errorf("entity A %s not found", idA)
	}
	if _, ok := entities[idB]; !ok {
		return nil, fmt.Errorf("entity B %s not found", idB)
	}

	return &HorizontalDistanceEvaluator{p1: idA, p2: idB, value: h.GetValue()}, nil
}

func (h *HorizontalDistanceEvaluator) NumEquations() int {
	return 1
}

func (h *HorizontalDistanceEvaluator) EvaluateJacobian(x []float64, residuals []float64, J *mat.Dense, rowOffset int, paramIndices map[gcstypes.EntityID]int) {
	idx1, ok1 := paramIndices[h.p1]
	idx2, ok2 := paramIndices[h.p2]
	if !ok1 || !ok2 {
		return
	}

	x1 := x[idx1]
	x2 := x[idx2]

	residuals[0] = (x1 - x2) * (x1 - x2) - h.value * h.value

	if J != nil {
		J.Set(rowOffset, idx1, 2.0 * (x1 - x2))
		J.Set(rowOffset, idx2, -2.0 * (x1 - x2))
	}
}

func (h *HorizontalDistanceEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	idx1, ok1 := paramIndices[h.p1]
	idx2, ok2 := paramIndices[h.p2]
	if !ok1 || !ok2 {
		return 0.0
	}

	x1 := x[idx1]
	x2 := x[idx2]

	r := (x1 - x2) * (x1 - x2) - h.value * h.value
	if grad != nil {
		factor := 4.0 * r * (x1 - x2)
		grad[idx1] += factor
		grad[idx2] -= factor
	}
	return r * r
}
