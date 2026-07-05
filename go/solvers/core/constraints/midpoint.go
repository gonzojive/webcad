package constraints

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"fmt"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/mat"
)

// MidpointEvaluator evaluates midpoint constraints, constraining a point to be the midpoint of a line segment.
type MidpointEvaluator struct {
	idPt       gcstypes.EntityID
	p1ln, p2ln gcstypes.EntityID
}

// NewMidpointEvaluator creates a new MidpointEvaluator for the given constraint.
func NewMidpointEvaluator(c *schema.Constraint, entities map[gcstypes.EntityID]*schema.Entity) (*MidpointEvaluator, error) {
	m := c.GetMidpoint()
	idPt := gcstypes.EntityID(m.GetPoint())
	idLn := gcstypes.EntityID(m.GetLine())
	entPt, okPt := entities[idPt]
	if !okPt {
		return nil, fmt.Errorf("point entity %s not found", idPt)
	}
	if !isPoint(entPt) {
		return nil, fmt.Errorf("entity %s is not a point", idPt)
	}
	entLn, okLn := entities[idLn]
	if !okLn {
		return nil, fmt.Errorf("line entity %s not found", idLn)
	}
	
	p1Id, p2Id, _, _, err := getLinePoints(entLn, entities)
	if err != nil {
		return nil, fmt.Errorf("line endpoints unresolved: %w", err)
	}
	return &MidpointEvaluator{
		idPt: idPt,
		p1ln: p1Id,
		p2ln: p2Id,
	}, nil
}

// Evaluate computes the squared residual and accumulates the gradient.
func (m *MidpointEvaluator) Evaluate(x []float64, grad []float64, paramIndices map[gcstypes.EntityID]int) float64 {
	idxPt, okPt := paramIndices[m.idPt]
	idxP1, ok1 := paramIndices[m.p1ln]
	idxP2, ok2 := paramIndices[m.p2ln]
	if !okPt || !ok1 || !ok2 {
		return 0.0
	}

	px, py := x[idxPt], x[idxPt+1]
	x1, y1 := x[idxP1], x[idxP1+1]
	x2, y2 := x[idxP2], x[idxP2+1]

	mx := 0.5 * (x1 + x2)
	my := 0.5 * (y1 + y2)

	rx := px - mx
	ry := py - my
	totalResidualSq := rx*rx + ry*ry

	if grad != nil {
		grad[idxPt] += 2.0 * rx
		grad[idxPt+1] += 2.0 * ry

		grad[idxP1] -= rx
		grad[idxP1+1] -= ry
		grad[idxP2] -= rx
		grad[idxP2+1] -= ry
	}
	return totalResidualSq
}

// NumEquations returns the number of equations (2).
func (m *MidpointEvaluator) NumEquations() int {
	return 2
}

// EvaluateJacobian evaluates the unsquared residuals and writes them to J.
func (m *MidpointEvaluator) EvaluateJacobian(x []float64, residuals []float64, J *mat.Dense, rowOffset int, paramIndices map[gcstypes.EntityID]int) {
	idxPt, okPt := paramIndices[m.idPt]
	idxP1, ok1 := paramIndices[m.p1ln]
	idxP2, ok2 := paramIndices[m.p2ln]
	if !okPt || !ok1 || !ok2 {
		return
	}

	px, py := x[idxPt], x[idxPt+1]
	x1, y1 := x[idxP1], x[idxP1+1]
	x2, y2 := x[idxP2], x[idxP2+1]

	residuals[0] = px - 0.5*(x1+x2)
	residuals[1] = py - 0.5*(y1+y2)

	if J != nil {
		// Row 0: r_0 = px - 0.5*x1 - 0.5*x2
		J.Set(rowOffset, idxPt, 1.0)
		J.Set(rowOffset, idxP1, -0.5)
		J.Set(rowOffset, idxP2, -0.5)

		// Row 1: r_1 = py - 0.5*y1 - 0.5*y2
		J.Set(rowOffset+1, idxPt+1, 1.0)
		J.Set(rowOffset+1, idxP1+1, -0.5)
		J.Set(rowOffset+1, idxP2+1, -0.5)
	}
}
