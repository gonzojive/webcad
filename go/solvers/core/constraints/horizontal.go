package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

type HorizontalEvaluator struct {
	p1, p2 gcstypes.EntityID
}

func NewHorizontalEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*HorizontalEvaluator, error) {
	h := c.GetHorizontal()
	idLn := gcstypes.EntityID(h.GetLineId())
	entLn, ok := entities[idLn]
	if !ok {
		return nil, fmt.Errorf("line entity %s not found", idLn)
	}

	p1Id, p2Id, _, _, err := getLinePoints(entLn, entities)
	if err != nil {
		return nil, fmt.Errorf("line endpoints unresolved: %w", err)
	}

	return &HorizontalEvaluator{p1: p1Id, p2: p2Id}, nil
}

func (h *HorizontalEvaluator) NumEquations() int {
	return 1
}

func (h *HorizontalEvaluator) EvaluateJacobian(x []float64, residuals []float64, J *mat.Dense, rowOffset int, paramIndices map[gcstypes.EntityID]int) {
	idx1, ok1 := paramIndices[h.p1]
	idx2, ok2 := paramIndices[h.p2]
	if !ok1 || !ok2 {
		return
	}

	y1 := x[idx1+1]
	y2 := x[idx2+1]

	residuals[0] = y1 - y2

	if J != nil {
		J.Set(rowOffset, idx1+1, 1.0)
		J.Set(rowOffset, idx2+1, -1.0)
	}
}

func (h *HorizontalEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	idx1, ok1 := paramIndices[h.p1]
	idx2, ok2 := paramIndices[h.p2]
	if !ok1 || !ok2 {
		return 0.0
	}

	y1 := x[idx1+1]
	y2 := x[idx2+1]

	r := y1 - y2
	if grad != nil {
		grad[idx1+1] += 2.0 * r
		grad[idx2+1] -= 2.0 * r
	}
	return r * r
}
