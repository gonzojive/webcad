package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

type VerticalEvaluator struct {
	p1, p2 gcstypes.EntityID
}

func NewVerticalEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*VerticalEvaluator, error) {
	v := c.GetVertical()
	idLn := gcstypes.EntityID(v.GetLineId())
	entLn, ok := entities[idLn]
	if !ok {
		return nil, fmt.Errorf("line entity %s not found", idLn)
	}

	p1Id, p2Id, _, _, err := getLinePoints(entLn, entities)
	if err != nil {
		return nil, fmt.Errorf("line endpoints unresolved: %w", err)
	}

	return &VerticalEvaluator{p1: p1Id, p2: p2Id}, nil
}

func (v *VerticalEvaluator) NumEquations() int {
	return 1
}

func (v *VerticalEvaluator) EvaluateJacobian(x []float64, residuals []float64, J *mat.Dense, rowOffset int, paramIndices map[gcstypes.EntityID]int) {
	idx1, ok1 := paramIndices[v.p1]
	idx2, ok2 := paramIndices[v.p2]
	if !ok1 || !ok2 {
		return
	}

	x1 := x[idx1]
	x2 := x[idx2]

	residuals[0] = x1 - x2

	if J != nil {
		J.Set(rowOffset, idx1, 1.0)
		J.Set(rowOffset, idx2, -1.0)
	}
}

func (v *VerticalEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	idx1, ok1 := paramIndices[v.p1]
	idx2, ok2 := paramIndices[v.p2]
	if !ok1 || !ok2 {
		return 0.0
	}

	x1 := x[idx1]
	x2 := x[idx2]

	r := x1 - x2
	if grad != nil {
		grad[idx1] += 2.0 * r
		grad[idx2] -= 2.0 * r
	}
	return r * r
}
