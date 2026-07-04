package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"math"

	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

type tangentSubCase int

const (
	tangentCirCir tangentSubCase = iota
	tangentCirLn
)

// TangentEvaluator evaluates tangent constraints between entities (Circle-Circle, Circle-Line).
type TangentEvaluator struct {
	subCase    tangentSubCase
	idA, idB   gcstypes.EntityID // idA is always the Circle for Cir-Ln. For Cir-Ln, idB is unused.
	p1ln, p2ln gcstypes.EntityID // For Cir-Ln case
	isInternal bool   // For Cir-Cir
	invC       float64
}

// NewTangentEvaluator creates a new TangentEvaluator for the given constraint.
func NewTangentEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*TangentEvaluator, error) {
	t := c.GetTangent()
	idA := gcstypes.EntityID(t.GetEntityA())
	idB := gcstypes.EntityID(t.GetEntityB())
	entA, okA := entities[idA]
	entB, okB := entities[idB]
	if !okA || !okB {
		return nil, fmt.Errorf("entities not found: %s, %s", idA, idB)
	}

	isCirA := isCircleOrArc(entA)
	isCirB := isCircleOrArc(entB)
	isLnA := isLine(entA)
	isLnB := isLine(entB)

	if isCirA && isCirB {
		// Determine and lock chirality based on initial state
		paramsA := getParams(entA)
		paramsB := getParams(entB)
		if len(paramsA) < 3 || len(paramsB) < 3 {
			return nil, fmt.Errorf("invalid circle parameters")
		}
		cxA, cyA, rA := paramsA[0], paramsA[1], paramsA[2]
		cxB, cyB, rB := paramsB[0], paramsB[1], paramsB[2]

		dx := cxA - cxB
		dy := cyA - cyB
		d := math.Sqrt(dx*dx + dy*dy)

		extErr := math.Abs(d - (rA + rB))
		intErr := math.Abs(d - math.Abs(rA-rB))

		isInternal := intErr < extErr

		return &TangentEvaluator{
			subCase:    tangentCirCir,
			idA:        idA,
			idB:        idB,
			isInternal: isInternal,
		}, nil
	} else if isCirA && isLnB {
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
		return &TangentEvaluator{
			subCase:  tangentCirLn,
			idA:      idA,
			p1ln:     p1Id,
			p2ln:     p2Id,
			invC:     1.0 / C,
		}, nil
	} else if isCirB && isLnA {
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
		return &TangentEvaluator{
			subCase:  tangentCirLn,
			idA:      idB, // Store circle in idA
			p1ln:     p1Id,
			p2ln:     p2Id,
			invC:     1.0 / C,
		}, nil
	}

	return nil, fmt.Errorf("unsupported tangent configuration between %T and %T", entA.GetEntityType(), entB.GetEntityType())
}

// NumEquations returns the number of equations (1).
func (t *TangentEvaluator) NumEquations() int {
	return 1
}

// EvaluateJacobian evaluates the unsquared residuals and writes them to J.
func (t *TangentEvaluator) EvaluateJacobian(
	x []float64,
	residuals []float64,
	J *mat.Dense,
	rowOffset int,
	paramIndices map[gcstypes.EntityID]int,
) {
	switch t.subCase {
	case tangentCirCir:
		idx1, ok1 := paramIndices[t.idA]
		idx2, ok2 := paramIndices[t.idB]
		if !ok1 || !ok2 {
			return
		}
		cx1, cy1, r1 := x[idx1], x[idx1+1], x[idx1+2]
		cx2, cy2, r2 := x[idx2], x[idx2+1], x[idx2+2]
		dx := cx1 - cx2
		dy := cy1 - cy2
		dSq := dx*dx + dy*dy

		var s float64
		if t.isInternal {
			s = r1 - r2
		} else {
			s = r1 + r2
		}
		sSq := s * s

		// r = d^2 - (r1 \pm r2)^2
		residuals[0] = dSq - sSq

		if J != nil {
			J.Set(rowOffset, idx1, 2.0*dx)
			J.Set(rowOffset, idx1+1, 2.0*dy)
			J.Set(rowOffset, idx2, -2.0*dx)
			J.Set(rowOffset, idx2+1, -2.0*dy)

			J.Set(rowOffset, idx1+2, -2.0*s)
			if t.isInternal {
				J.Set(rowOffset, idx2+2, 2.0*s)
			} else {
				J.Set(rowOffset, idx2+2, -2.0*s)
			}
		}

	case tangentCirLn:
		idx1, ok1 := paramIndices[t.idA]
		idxP1, okP1 := paramIndices[t.p1ln]
		idxP2, okP2 := paramIndices[t.p2ln]
		if !ok1 || !okP1 || !okP2 {
			return
		}
		cx, cy, R := x[idx1], x[idx1+1], x[idx1+2]
		x1, y1 := x[idxP1], x[idxP1+1]
		x2, y2 := x[idxP2], x[idxP2+1]
		dxL := x2 - x1
		dyL := y2 - y1
		C := dxL*dxL + dyL*dyL
		if C < 1e-9 {
			C = 1.0
		}
		invC := 1.0 / C

		num := dyL*(cx-x1) - dxL*(cy-y1)

		// r = num^2 / C - R^2
		residuals[0] = num*num*invC - R*R

		if J != nil {
			factor := 2.0 * num * invC
			factorK := factor * num * invC
			J.Set(rowOffset, idx1, factor*dyL)
			J.Set(rowOffset, idx1+1, -factor*dxL)
			J.Set(rowOffset, idxP1, factor*(cy-y2)+factorK*dxL)
			J.Set(rowOffset, idxP1+1, factor*(x2-cx)+factorK*dyL)
			J.Set(rowOffset, idxP2, factor*(y1-cy)-factorK*dxL)
			J.Set(rowOffset, idxP2+1, factor*(cx-x1)-factorK*dyL)

			J.Set(rowOffset, idx1+2, -2.0*R)
		}
	}
}

// Evaluate computes the squared residual and accumulates the gradient.
func (t *TangentEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	switch t.subCase {
	case tangentCirCir:
		idx1, ok1 := paramIndices[t.idA]
		idx2, ok2 := paramIndices[t.idB]
		if !ok1 || !ok2 {
			return 0.0
		}
		cx1, cy1, r1 := x[idx1], x[idx1+1], x[idx1+2]
		cx2, cy2, r2 := x[idx2], x[idx2+1], x[idx2+2]
		dx := cx1 - cx2
		dy := cy1 - cy2
		dSq := dx*dx + dy*dy

		var s float64
		if t.isInternal {
			s = r1 - r2
		} else {
			s = r1 + r2
		}
		sSq := s * s

		// r = d^2 - (r1 \pm r2)^2
		r := dSq - sSq
		totalResidualSq := r * r

		if grad != nil {
			factor := 2.0 * r

			// dr/dcx1 = 2*dx, dr/dcy1 = 2*dy
			// dr/dcx2 = -2*dx, dr/dcy2 = -2*dy
			dr_dcx1 := 2.0 * dx
			dr_dcy1 := 2.0 * dy

			grad[idx1] += factor * dr_dcx1
			grad[idx1+1] += factor * dr_dcy1
			grad[idx2] -= factor * dr_dcx1
			grad[idx2+1] -= factor * dr_dcy1

			// dr/dr1 = -2*s
			// dr/dr2 = -2*s (external) or 2*s (internal)
			dr_dr1 := -2.0 * s
			var dr_dr2 float64
			if t.isInternal {
				dr_dr2 = 2.0 * s
			} else {
				dr_dr2 = -2.0 * s
			}

			grad[idx1+2] += factor * dr_dr1
			grad[idx2+2] += factor * dr_dr2
		}
		return totalResidualSq

	case tangentCirLn:
		idx1, ok1 := paramIndices[t.idA]
		idxP1, okP1 := paramIndices[t.p1ln]
		idxP2, okP2 := paramIndices[t.p2ln]
		if !ok1 || !okP1 || !okP2 {
			return 0.0
		}
		cx, cy, R := x[idx1], x[idx1+1], x[idx1+2]
		x1, y1 := x[idxP1], x[idxP1+1]
		x2, y2 := x[idxP2], x[idxP2+1]
		dxL := x2 - x1
		dyL := y2 - y1
		C := dxL*dxL + dyL*dyL
		if C < 1e-9 {
			C = 1.0
		}
		invC := 1.0 / C

		num := dyL*(cx-x1) - dxL*(cy-y1)

		// r = num^2 / C - R^2
		r := num*num*invC - R*R
		valSq := r * r

		if grad != nil {
			factor := 4.0 * r * num * invC
			factorK := 2.0 * r * (num * invC) * (num * invC)

			grad[idx1] += factor * dyL
			grad[idx1+1] -= factor * dxL
			grad[idxP1] += factor*(cy-y2) + 2.0*factorK*dxL
			grad[idxP1+1] += factor*(x2-cx) + 2.0*factorK*dyL
			grad[idxP2] += factor*(y1-cy) - 2.0*factorK*dxL
			grad[idxP2+1] += factor*(cx-x1) - 2.0*factorK*dyL

			grad[idx1+2] -= 4.0 * r * R
		}
		return valSq
	}

	return 0.0
}
