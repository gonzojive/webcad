package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"

	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

type distanceSubCase int

const (
	distancePtPt distanceSubCase = iota
	distancePtLn
)

// DistanceEvaluator evaluates distance constraints between entities (Point-Point, Point-Line).
type DistanceEvaluator struct {
	subCase    distanceSubCase
	idA, idB   gcstypes.EntityID  // idA is always the Point for Pt-Ln. For Pt-Ln, idB is unused.
	p1ln, p2ln gcstypes.EntityID  // For Pt-Ln case
	value      float64 // D
	invC       float64 // 1/C, where C is initial line length squared (for Pt-Ln)
}

// NewDistanceEvaluator creates a new DistanceEvaluator for the given constraint.
func NewDistanceEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*DistanceEvaluator, error) {
	d := c.GetDistance()
	idA := gcstypes.EntityID(d.GetEntityA())
	idB := gcstypes.EntityID(d.GetEntityB())
	entA, okA := entities[idA]
	entB, okB := entities[idB]
	if !okA || !okB {
		return nil, fmt.Errorf("entities not found: %s, %s", idA, idB)
	}

	isPtA := isPointOrCenter(entA)
	isPtB := isPointOrCenter(entB)
	isLnA := isLine(entA)
	isLnB := isLine(entB)

	if isPtA && isPtB {
		return &DistanceEvaluator{
			subCase: distancePtPt,
			idA:     idA,
			idB:     idB,
			value:   d.GetValue(),
		}, nil
	} else if isPtA && isLnB {
		p1Id, p2Id, p1, p2, err := getLinePoints(entB, entities)
		if err != nil {
			return nil, fmt.Errorf("line B endpoints unresolved: %w", err)
		}
		dx := p2.X - p1.X
		dy := p2.Y - p1.Y
		C := dx*dx + dy*dy
		if C < 1e-9 {
			C = 1.0
		}
		return &DistanceEvaluator{
			subCase:  distancePtLn,
			idA:      idA,
			p1ln:     p1Id,
			p2ln:     p2Id,
			value:    d.GetValue(),
			invC:     1.0 / C,
		}, nil
	} else if isPtB && isLnA {
		p1Id, p2Id, p1, p2, err := getLinePoints(entA, entities)
		if err != nil {
			return nil, fmt.Errorf("line A endpoints unresolved: %w", err)
		}
		dx := p2.X - p1.X
		dy := p2.Y - p1.Y
		C := dx*dx + dy*dy
		if C < 1e-9 {
			C = 1.0
		}
		return &DistanceEvaluator{
			subCase:  distancePtLn,
			idA:      idB, // Store point in idA
			p1ln:     p1Id,
			p2ln:     p2Id,
			value:    d.GetValue(),
			invC:     1.0 / C,
		}, nil
	}

	return nil, fmt.Errorf("unsupported distance configuration between %T and %T", entA.GetEntityType(), entB.GetEntityType())
}

// NumEquations returns the number of equations (1).
func (d *DistanceEvaluator) NumEquations() int {
	return 1
}

// EvaluateJacobian evaluates the unsquared residuals and writes them to J.
func (d *DistanceEvaluator) EvaluateJacobian(
	x []float64,
	residuals []float64,
	J *mat.Dense,
	rowOffset int,
	paramIndices map[gcstypes.EntityID]int,
) {
	switch d.subCase {
	case distancePtPt:
		idx1, ok1 := paramIndices[d.idA]
		idx2, ok2 := paramIndices[d.idB]
		if !ok1 || !ok2 {
			return
		}
		dx := x[idx1] - x[idx2]
		dy := x[idx1+1] - x[idx2+1]
		dSq := dx*dx + dy*dy

		// r = d^2 - D^2
		residuals[0] = dSq - d.value*d.value

		if J != nil {
			J.Set(rowOffset, idx1, 2.0*dx)
			J.Set(rowOffset, idx1+1, 2.0*dy)
			J.Set(rowOffset, idx2, -2.0*dx)
			J.Set(rowOffset, idx2+1, -2.0*dy)
		}

	case distancePtLn:
		idx1, ok1 := paramIndices[d.idA]
		idxP1, okP1 := paramIndices[d.p1ln]
		idxP2, okP2 := paramIndices[d.p2ln]
		if !ok1 || !okP1 || !okP2 {
			return
		}
		px, py := x[idx1], x[idx1+1]
		x1, y1 := x[idxP1], x[idxP1+1]
		x2, y2 := x[idxP2], x[idxP2+1]
		dxL := x2 - x1
		dyL := y2 - y1

		num := dyL*(px-x1) - dxL*(py-y1)

		// r = num^2 / C - D^2
		residuals[0] = num*num*d.invC - d.value*d.value

		if J != nil {
			factor := 2.0 * num * d.invC
			J.Set(rowOffset, idx1, factor*dyL)
			J.Set(rowOffset, idx1+1, -factor*dxL)
			J.Set(rowOffset, idxP1, factor*(py-y2))
			J.Set(rowOffset, idxP1+1, factor*(x2-px))
			J.Set(rowOffset, idxP2, factor*(y1-py))
			J.Set(rowOffset, idxP2+1, factor*(px-x1))
		}
	}
}

// Evaluate computes the squared residual and accumulates the gradient.
func (d *DistanceEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	switch d.subCase {
	case distancePtPt:
		idx1, ok1 := paramIndices[d.idA]
		idx2, ok2 := paramIndices[d.idB]
		if !ok1 || !ok2 {
			return 0.0
		}
		dx := x[idx1] - x[idx2]
		dy := x[idx1+1] - x[idx2+1]
		dSq := dx*dx + dy*dy

		// r = d^2 - D^2
		r := dSq - d.value*d.value
		valSq := r * r

		if grad != nil {
			factor := 4.0 * r
			grad[idx1] += factor * dx
			grad[idx1+1] += factor * dy
			grad[idx2] -= factor * dx
			grad[idx2+1] -= factor * dy
		}
		return valSq

	case distancePtLn:
		idx1, ok1 := paramIndices[d.idA]
		idxP1, okP1 := paramIndices[d.p1ln]
		idxP2, okP2 := paramIndices[d.p2ln]
		if !ok1 || !okP1 || !okP2 {
			return 0.0
		}
		px, py := x[idx1], x[idx1+1]
		x1, y1 := x[idxP1], x[idxP1+1]
		x2, y2 := x[idxP2], x[idxP2+1]
		dxL := x2 - x1
		dyL := y2 - y1

		num := dyL*(px-x1) - dxL*(py-y1)

		// r = num^2 / C - D^2
		r := num*num*d.invC - d.value*d.value
		valSq := r * r

		if grad != nil {
			factor := 4.0 * r * num * d.invC

			grad[idx1] += factor * dyL
			grad[idx1+1] -= factor * dxL
			grad[idxP1] += factor * (py - y2)
			grad[idxP1+1] += factor * (x2 - px)
			grad[idxP2] += factor * (y1 - py)
			grad[idxP2+1] += factor * (px - x1)
		}
		return valSq
	}

	return 0.0
}
