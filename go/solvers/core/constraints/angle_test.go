package constraints_test

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"math"
	"math/rand"
	"testing"

	"github.com/gonzojive/webcad/go/solvers/core/constraints"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/diff/fd"
	"gonum.org/v1/gonum/mat"
)

func TestAngleEvaluator_Jacobian(t *testing.T) {
	p1a := &schema.Entity{Id: "p1a", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 0.0, Y: 0.0}}}
	p2a := &schema.Entity{Id: "p2a", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 2.0, Y: 0.0}}}
	p1b := &schema.Entity{Id: "p1b", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 0.0, Y: 0.0}}}
	p2b := &schema.Entity{Id: "p2b", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 1.0, Y: 1.0}}}

	l1 := &schema.Entity{Id: "l1", EntityType: &schema.Entity_Line{Line: &schema.LineEntity{P1Id: "p1a", P2Id: "p2a"}}}
	l2 := &schema.Entity{Id: "l2", EntityType: &schema.Entity_Line{Line: &schema.LineEntity{P1Id: "p1b", P2Id: "p2b"}}}
	c := &schema.Constraint{
		Id: "c",
		ConstraintType: &schema.Constraint_Angle{
			Angle: &schema.AngleConstraint{EntityA: "l1", EntityB: "l2", ValueRadians: math.Pi / 4},
		},
	}
	entities := map[gcstypes.EntityID]*schema.Entity{
		"p1a": p1a, "p2a": p2a,
		"p1b": p1b, "p2b": p2b,
		"l1": l1, "l2": l2,
	}
	eval, err := constraints.NewEvaluator(c, entities)
	if err != nil {
		t.Fatalf("failed to create evaluator: %v", err)
	}

	je, ok := eval.(constraints.JacobianEvaluator)
	if !ok {
		t.Fatalf("evaluator does not implement JacobianEvaluator")
	}

	rng := rand.New(rand.NewSource(42))
	paramIndices := map[gcstypes.EntityID]int{
		"p1a": 0, "p2a": 2,
		"p1b": 4, "p2b": 6,
	}
	n := 8
	m := je.NumEquations()

	if m != 1 {
		t.Errorf("expected 1 equation, got %d", m)
	}

	for k := 0; k < 10; k++ {
		x := []float64{
			0.0 + (rng.Float64()-0.5)*0.1, 0.0 + (rng.Float64()-0.5)*0.1,
			2.0 + (rng.Float64()-0.5)*0.1, 0.0 + (rng.Float64()-0.5)*0.1,
			0.0 + (rng.Float64()-0.5)*0.1, 0.0 + (rng.Float64()-0.5)*0.1,
			1.0 + (rng.Float64()-0.5)*0.1, 1.0 + (rng.Float64()-0.5)*0.1,
		}

		gradActual := make([]float64, n)
		valActual := eval.Evaluate(x, gradActual, paramIndices)

		// Test EvaluateJacobian
		residuals := make([]float64, m)
		J := mat.NewDense(m, n, nil)
		je.EvaluateJacobian(x, residuals, J, 0, paramIndices)

		// Verify residuals sum of squares matches Evaluate value
		resSqSum := 0.0
		for _, r := range residuals {
			resSqSum += r * r
		}
		if math.Abs(resSqSum-valActual) > 1e-9 {
			t.Errorf("[%d] Jacobian residuals sum of squares %f does not match Evaluate value %f", k, resSqSum, valActual)
		}

		// Verify analytical Jacobian against numerical finite differences
		f := func(dst, xs []float64) {
			je.EvaluateJacobian(xs, dst, nil, 0, paramIndices)
		}
		fdJacobian := mat.NewDense(m, n, nil)
		fd.Jacobian(fdJacobian, f, x, &fd.JacobianSettings{Formula: fd.Central})

		for i := 0; i < m; i++ {
			for j := 0; j < n; j++ {
				diff := math.Abs(J.At(i, j) - fdJacobian.At(i, j))
				if diff > 1e-5 {
					t.Errorf("[%d] Jacobian mismatch at (%d, %d): got %f, want %f", k, i, j, J.At(i, j), fdJacobian.At(i, j))
				}
			}
		}
	}
}
