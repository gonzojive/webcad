package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"math"

	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

// ParallelEvaluator evaluates parallel constraints between two line entities.
type ParallelEvaluator struct {
	p1a, p2a gcstypes.EntityID
	p1b, p2b gcstypes.EntityID
	normC    float64
}

// NewParallelEvaluator creates a new ParallelEvaluator for the given constraint.
func NewParallelEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*ParallelEvaluator, error) {
	p := c.GetParallel()
	idA := gcstypes.EntityID(p.GetLineA())
	idB := gcstypes.EntityID(p.GetLineB())
	entA, okA := entities[idA]
	entB, okB := entities[idB]
	if !okA || !okB {
		return nil, fmt.Errorf("entities not found: %s, %s", idA, idB)
	}

	p1aId, p2aId, p1a, p2a, err := getLinePoints(entA, entities)
	if err != nil {
		return nil, fmt.Errorf("line A endpoints unresolved: %w", err)
	}
	p1bId, p2bId, p1b, p2b, err := getLinePoints(entB, entities)
	if err != nil {
		return nil, fmt.Errorf("line B endpoints unresolved: %w", err)
	}

	// Compute constant normalization using initial lengths
	ilen1Sq := (p2a.X-p1a.X)*(p2a.X-p1a.X) + (p2a.Y-p1a.Y)*(p2a.Y-p1a.Y)
	ilen2Sq := (p2b.X-p1b.X)*(p2b.X-p1b.X) + (p2b.Y-p1b.Y)*(p2b.Y-p1b.Y)
	if ilen1Sq < 1e-9 {
		ilen1Sq = 1.0
	}
	if ilen2Sq < 1e-9 {
		ilen2Sq = 1.0
	}
	normC := math.Sqrt(ilen1Sq * ilen2Sq)

	return &ParallelEvaluator{
		p1a:   p1aId,
		p2a:   p2aId,
		p1b:   p1bId,
		p2b:   p2bId,
		normC: normC,
	}, nil
}

// NumEquations returns the number of equations (1).
func (p *ParallelEvaluator) NumEquations() int {
	return 1
}

// EvaluateJacobian evaluates the unsquared residuals and writes them to J.
func (p *ParallelEvaluator) EvaluateJacobian(
	x []float64,
	residuals []float64,
	J *mat.Dense,
	rowOffset int,
	paramIndices map[gcstypes.EntityID]int,
) {
	idx1a, ok1a := paramIndices[p.p1a]
	idx2a, ok2a := paramIndices[p.p2a]
	idx1b, ok1b := paramIndices[p.p1b]
	idx2b, ok2b := paramIndices[p.p2b]
	if !ok1a || !ok2a || !ok1b || !ok2b {
		return
	}

	x1, y1 := x[idx1a], x[idx1a+1]
	x2, y2 := x[idx2a], x[idx2a+1]
	x3, y3 := x[idx1b], x[idx1b+1]
	x4, y4 := x[idx2b], x[idx2b+1]

	dx1, dy1 := x2-x1, y2-y1
	dx2, dy2 := x4-x3, y4-y3
	cross := dx1*dy2 - dy1*dx2

	// r = cross / normC
	residuals[0] = cross / p.normC

	if J != nil {
		invC := 1.0 / p.normC
		// Row 0 of this constraint's Jacobian block
		J.Set(rowOffset, idx1a, -dy2*invC)
		J.Set(rowOffset, idx1a+1, dx2*invC)
		J.Set(rowOffset, idx2a, dy2*invC)
		J.Set(rowOffset, idx2a+1, -dx2*invC)

		J.Set(rowOffset, idx1b, dy1*invC)
		J.Set(rowOffset, idx1b+1, -dx1*invC)
		J.Set(rowOffset, idx2b, -dy1*invC)
		J.Set(rowOffset, idx2b+1, dx1*invC)
	}
}

// Evaluate computes the squared residual and accumulates the gradient.
func (p *ParallelEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	idx1a, ok1a := paramIndices[p.p1a]
	idx2a, ok2a := paramIndices[p.p2a]
	idx1b, ok1b := paramIndices[p.p1b]
	idx2b, ok2b := paramIndices[p.p2b]
	if !ok1a || !ok2a || !ok1b || !ok2b {
		return 0.0
	}

	x1, y1 := x[idx1a], x[idx1a+1]
	x2, y2 := x[idx2a], x[idx2a+1]
	x3, y3 := x[idx1b], x[idx1b+1]
	x4, y4 := x[idx2b], x[idx2b+1]

	dx1, dy1 := x2-x1, y2-y1
	dx2, dy2 := x4-x3, y4-y3
	cross := dx1*dy2 - dy1*dx2
	r := cross / p.normC
	totalResidualSq := r * r

	if grad != nil {
		factor := 2.0 * r / p.normC
		grad[idx1a] -= factor * dy2
		grad[idx1a+1] += factor * dx2
		grad[idx2a] += factor * dy2
		grad[idx2a+1] -= factor * dx2

		grad[idx1b] += factor * dy1
		grad[idx1b+1] -= factor * dx1
		grad[idx2b] -= factor * dy1
		grad[idx2b+1] += factor * dx1
	}
	return totalResidualSq
}
