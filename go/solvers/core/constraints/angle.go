package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"math"

	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

// AngleEvaluator evaluates the angle constraint between two line entities.
type AngleEvaluator struct {
	p1a, p2a  gcstypes.EntityID
	p1b, p2b  gcstypes.EntityID
	sinTarget float64
	cosTarget float64
}

// NewAngleEvaluator creates a new AngleEvaluator for the given angle constraint.
func NewAngleEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*AngleEvaluator, error) {
	a := c.GetAngle()
	idA := gcstypes.EntityID(a.GetEntityA())
	idB := gcstypes.EntityID(a.GetEntityB())
	entA, okA := entities[idA]
	entB, okB := entities[idB]
	if !okA || !okB {
		return nil, fmt.Errorf("entities not found: %s, %s", idA, idB)
	}

	p1aId, p2aId, _, _, err := getLinePoints(entA, entities)
	if err != nil {
		return nil, fmt.Errorf("line A endpoints unresolved: %w", err)
	}
	p1bId, p2bId, _, _, err := getLinePoints(entB, entities)
	if err != nil {
		return nil, fmt.Errorf("line B endpoints unresolved: %w", err)
	}

	target := a.GetValueRadians()
	return &AngleEvaluator{
		p1a:       p1aId,
		p2a:       p2aId,
		p1b:       p1bId,
		p2b:       p2bId,
		sinTarget: math.Sin(target),
		cosTarget: math.Cos(target),
	}, nil
}

// NumEquations returns the number of equations (1).
func (a *AngleEvaluator) NumEquations() int {
	return 1
}

// EvaluateJacobian evaluates the unsquared residuals and Jacobian rows.
func (a *AngleEvaluator) EvaluateJacobian(
	x []float64,
	residuals []float64,
	J *mat.Dense,
	rowOffset int,
	paramIndices map[gcstypes.EntityID]int,
) {
	idx1a, ok1a := paramIndices[a.p1a]
	idx2a, ok2a := paramIndices[a.p2a]
	idx1b, ok1b := paramIndices[a.p1b]
	idx2b, ok2b := paramIndices[a.p2b]
	if !ok1a || !ok2a || !ok1b || !ok2b {
		return
	}

	x1_val, y1_val := x[idx1a], x[idx1a+1]
	x2_val, y2_val := x[idx2a], x[idx2a+1]
	x3_val, y3_val := x[idx1b], x[idx1b+1]
	x4_val, y4_val := x[idx2b], x[idx2b+1]

	v1x, v1y := x2_val-x1_val, y2_val-y1_val
	v2x, v2y := x4_val-x3_val, y4_val-y3_val

	dot := v1x*v2x + v1y*v2y
	cross := v1x*v2y - v1y*v2x

	// r = (v1 . v2)*sin(theta_T) - (v1 x v2)*cos(theta_T)
	residuals[0] = dot*a.sinTarget - cross*a.cosTarget

	if J != nil {
		dr_dv1x := v2x*a.sinTarget - v2y*a.cosTarget
		dr_dv1y := v2y*a.sinTarget + v2x*a.cosTarget
		dr_dv2x := v1x*a.sinTarget + v1y*a.cosTarget
		dr_dv2y := v1y*a.sinTarget - v1x*a.cosTarget

		// v1 = p2 - p1 => dv1/dp2 = 1, dv1/dp1 = -1
		// v2 = p4 - p3 => dv2/dp4 = 1, dv2/dp3 = -1
		J.Set(rowOffset, idx1a, -dr_dv1x)
		J.Set(rowOffset, idx1a+1, -dr_dv1y)
		J.Set(rowOffset, idx2a, dr_dv1x)
		J.Set(rowOffset, idx2a+1, dr_dv1y)

		J.Set(rowOffset, idx1b, -dr_dv2x)
		J.Set(rowOffset, idx1b+1, -dr_dv2y)
		J.Set(rowOffset, idx2b, dr_dv2x)
		J.Set(rowOffset, idx2b+1, dr_dv2y)
	}
}

// Evaluate computes the squared residual and accumulates the gradient.
func (a *AngleEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	idx1a, ok1a := paramIndices[a.p1a]
	idx2a, ok2a := paramIndices[a.p2a]
	idx1b, ok1b := paramIndices[a.p1b]
	idx2b, ok2b := paramIndices[a.p2b]
	if !ok1a || !ok2a || !ok1b || !ok2b {
		return 0.0
	}

	x1_val, y1_val := x[idx1a], x[idx1a+1]
	x2_val, y2_val := x[idx2a], x[idx2a+1]
	x3_val, y3_val := x[idx1b], x[idx1b+1]
	x4_val, y4_val := x[idx2b], x[idx2b+1]

	v1x, v1y := x2_val-x1_val, y2_val-y1_val
	v2x, v2y := x4_val-x3_val, y4_val-y3_val

	dot := v1x*v2x + v1y*v2y
	cross := v1x*v2y - v1y*v2x

	// r = (v1 . v2)*sin(theta_T) - (v1 x v2)*cos(theta_T)
	r := dot*a.sinTarget - cross*a.cosTarget
	totalResidualSq := r * r

	if grad != nil {
		factor := 2.0 * r

		// Derivatives of r w.r.t v1x, v1y, v2x, v2y
		dr_dv1x := v2x*a.sinTarget - v2y*a.cosTarget
		dr_dv1y := v2y*a.sinTarget + v2x*a.cosTarget
		dr_dv2x := v1x*a.sinTarget + v1y*a.cosTarget
		dr_dv2y := v1y*a.sinTarget - v1x*a.cosTarget

		// v1 = p2 - p1 => dv1/dp2 = 1, dv1/dp1 = -1
		// v2 = p4 - p3 => dv2/dp4 = 1, dv2/dp3 = -1

		grad[idx1a] -= factor * dr_dv1x
		grad[idx1a+1] -= factor * dr_dv1y
		grad[idx2a] += factor * dr_dv1x
		grad[idx2a+1] += factor * dr_dv1y

		grad[idx1b] -= factor * dr_dv2x
		grad[idx1b+1] -= factor * dr_dv2y
		grad[idx2b] += factor * dr_dv2x
		grad[idx2b+1] += factor * dr_dv2y
	}

	return totalResidualSq
}
