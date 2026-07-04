package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"math"

	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

type coincidenceSubCase int

const (
	coincidencePtPt coincidenceSubCase = iota
	coincidencePtLn
	coincidencePtCir
)

// CoincidenceEvaluator evaluates coincidence constraints (Point-Point, Point-Line, Point-Circle).
type CoincidenceEvaluator struct {
	subCase    coincidenceSubCase
	idA, idB   gcstypes.EntityID // idA is always the Point for Pt-Ln and Pt-Cir.
	p1ln, p2ln gcstypes.EntityID // For Pt-Ln case
	centerId   gcstypes.EntityID // For Pt-Cir case (resolved center of idB)
	invC       float64
	sqrtInvC   float64 // Precomputed sqrt(1/C) for Pt-Ln
}

// NewCoincidenceEvaluator creates a new CoincidenceEvaluator for the given constraint.
func NewCoincidenceEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*CoincidenceEvaluator, error) {
	cc := c.GetCoincidence()
	idA := gcstypes.EntityID(cc.GetEntityA())
	idB := gcstypes.EntityID(cc.GetEntityB())
	entA, okA := entities[idA]
	entB, okB := entities[idB]
	if !okA || !okB {
		return nil, fmt.Errorf("entities not found: %s, %s", idA, idB)
	}

	isPtA := isPoint(entA)
	isPtB := isPoint(entB)
	isLnA := isLine(entA)
	isLnB := isLine(entB)
	isCirA := isCircleOrArc(entA)
	isCirB := isCircleOrArc(entB)

	if isPtA && isPtB {
		return &CoincidenceEvaluator{
			subCase: coincidencePtPt,
			idA:     idA,
			idB:     idB,
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
		return &CoincidenceEvaluator{
			subCase:  coincidencePtLn,
			idA:      idA,
			p1ln:     p1Id,
			p2ln:     p2Id,
			invC:     1.0 / C,
			sqrtInvC: math.Sqrt(1.0 / C),
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
		return &CoincidenceEvaluator{
			subCase:  coincidencePtLn,
			idA:      idB, // Store point in idA
			p1ln:     p1Id,
			p2ln:     p2Id,
			invC:     1.0 / C,
			sqrtInvC: math.Sqrt(1.0 / C),
		}, nil
	} else if isPtA && isCirB {
		centerId, err := resolvePointOrCenter(idB, entities)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve circle B center: %w", err)
		}
		return &CoincidenceEvaluator{
			subCase:  coincidencePtCir,
			idA:      idA,
			idB:      idB,
			centerId: centerId,
		}, nil
	} else if isPtB && isCirA {
		centerId, err := resolvePointOrCenter(idA, entities)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve circle A center: %w", err)
		}
		return &CoincidenceEvaluator{
			subCase:  coincidencePtCir,
			idA:      idB, // Store point in idA
			idB:      idA, // Store circle in idB
			centerId: centerId,
		}, nil
	}

	return nil, fmt.Errorf("unsupported coincidence configuration between %T and %T", entA.GetEntityType(), entB.GetEntityType())
}

// NumEquations returns the number of independent equations (2 for Pt-Pt, 1 otherwise).
func (c *CoincidenceEvaluator) NumEquations() int {
	if c.subCase == coincidencePtPt {
		return 2
	}
	return 1
}

// EvaluateJacobian evaluates the unsquared residuals and writes them to J.
func (c *CoincidenceEvaluator) EvaluateJacobian(
	x []float64,
	residuals []float64,
	J *mat.Dense,
	rowOffset int,
	paramIndices map[gcstypes.EntityID]int,
) {
	switch c.subCase {
	case coincidencePtPt:
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
			// Row 0: r_x = x1 - x2
			J.Set(rowOffset, idx1, 1.0)
			J.Set(rowOffset, idx2, -1.0)

			// Row 1: r_y = y1 - y2
			J.Set(rowOffset+1, idx1+1, 1.0)
			J.Set(rowOffset+1, idx2+1, -1.0)
		}

	case coincidencePtLn:
		idx1, ok1 := paramIndices[c.idA]
		idxP1, okP1 := paramIndices[c.p1ln]
		idxP2, okP2 := paramIndices[c.p2ln]
		if !ok1 || !okP1 || !okP2 {
			return
		}
		px, py := x[idx1], x[idx1+1]
		x1, y1 := x[idxP1], x[idxP1+1]
		x2, y2 := x[idxP2], x[idxP2+1]
		dxL := x2 - x1
		dyL := y2 - y1

		num := dyL*(px-x1) - dxL*(py-y1)
		residuals[0] = num * c.sqrtInvC

		if J != nil {
			factor := c.sqrtInvC
			J.Set(rowOffset, idx1, factor*dyL)
			J.Set(rowOffset, idx1+1, -factor*dxL)
			J.Set(rowOffset, idxP1, factor*(py-y2))
			J.Set(rowOffset, idxP1+1, factor*(x2-px))
			J.Set(rowOffset, idxP2, factor*(y1-py))
			J.Set(rowOffset, idxP2+1, factor*(px-x1))
		}

	case coincidencePtCir:
		idx1, ok1 := paramIndices[c.idA]
		idxCenter, okCenter := paramIndices[c.centerId]
		idxCir, okCir := paramIndices[c.idB]
		if !ok1 || !okCenter || !okCir {
			return
		}
		px, py := x[idx1], x[idx1+1]
		cx, cy := x[idxCenter], x[idxCenter+1]
		R := x[idxCir]
		dx := cx - px
		dy := cy - py
		dSq := dx*dx + dy*dy

		// r = d^2 - R^2
		residuals[0] = dSq - R*R

		if J != nil {
			J.Set(rowOffset, idx1, -2.0*dx)
			J.Set(rowOffset, idx1+1, -2.0*dy)
			J.Set(rowOffset, idxCenter, 2.0*dx)
			J.Set(rowOffset, idxCenter+1, 2.0*dy)
			J.Set(rowOffset, idxCir, -2.0*R)
		}
	}
}

// Evaluate computes the squared residual and accumulates the gradient.
func (c *CoincidenceEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	switch c.subCase {
	case coincidencePtPt:
		idx1, ok1 := paramIndices[c.idA]
		idx2, ok2 := paramIndices[c.idB]
		if !ok1 || !ok2 {
			return 0.0
		}
		dx := x[idx1] - x[idx2]
		dy := x[idx1+1] - x[idx2+1]
		if grad != nil {
			grad[idx1] += 2.0 * dx
			grad[idx1+1] += 2.0 * dy
			grad[idx2] -= 2.0 * dx
			grad[idx2+1] -= 2.0 * dy
		}
		return dx*dx + dy*dy

	case coincidencePtLn:
		idx1, ok1 := paramIndices[c.idA]
		idxP1, okP1 := paramIndices[c.p1ln]
		idxP2, okP2 := paramIndices[c.p2ln]
		if !ok1 || !okP1 || !okP2 {
			return 0.0
		}
		px, py := x[idx1], x[idx1+1]
		x1, y1 := x[idxP1], x[idxP1+1]
		x2, y2 := x[idxP2], x[idxP2+1]
		dxL := x2 - x1
		dyL := y2 - y1

		num := dyL*(px-x1) - dxL*(py-y1)

		// E_i = num^2 / C
		valSq := num * num * c.invC

		if grad != nil {
			factor := 2.0 * num * c.invC

			grad[idx1] += factor * dyL
			grad[idx1+1] -= factor * dxL
			grad[idxP1] += factor * (py - y2)
			grad[idxP1+1] += factor * (x2 - px)
			grad[idxP2] += factor * (y1 - py)
			grad[idxP2+1] += factor * (px - x1)
		}
		return valSq

	case coincidencePtCir:
		idx1, ok1 := paramIndices[c.idA]
		idxCenter, okCenter := paramIndices[c.centerId]
		idxCir, okCir := paramIndices[c.idB]
		if !ok1 || !okCenter || !okCir {
			return 0.0
		}
		px, py := x[idx1], x[idx1+1]
		cx, cy := x[idxCenter], x[idxCenter+1]
		R := x[idxCir]
		dx := cx - px
		dy := cy - py
		dSq := dx*dx + dy*dy

		// r = d^2 - R^2
		r := dSq - R*R
		valSq := r * r

		if grad != nil {
			factor := 4.0 * r
			grad[idx1] -= factor * dx
			grad[idx1+1] -= factor * dy
			grad[idxCenter] += factor * dx
			grad[idxCenter+1] += factor * dy
			grad[idxCir] -= factor * R
		}
		return valSq
	}

	return 0.0
}
