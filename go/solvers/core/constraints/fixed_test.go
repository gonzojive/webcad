package constraints_test

import (
	"github.com/gonzojive/webcad/go/solvers/core/gcstypes"
	"math"
	"math/rand"
	"testing"

	"github.com/gonzojive/webcad/go/solvers/core"
	"github.com/gonzojive/webcad/go/solvers/core/constraints"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/diff/fd"
	"gonum.org/v1/gonum/mat"
)

func TestFixedEvaluator(t *testing.T) {
	tests := []struct {
		name         string
		entities     []*schema.Entity
		constraint   *schema.Constraint
		targetID     gcstypes.EntityID
		paramIndices map[gcstypes.EntityID]int
		numEqs       int
		perturb      func(rng *rand.Rand) []float64
	}{
		{
			name: "FixedPoint",
			entities: []*schema.Entity{
				{
					Id: "p1",
					EntityType: &schema.Entity_Point{
						Point: &schema.PointEntity{X: 1.0, Y: 2.0},
					},
				},
			},
			constraint: &schema.Constraint{
				Id: "c1",
				ConstraintType: &schema.Constraint_Fixed{
					Fixed: &schema.FixedConstraint{
						EntityId: "p1",
					},
				},
			},
			targetID:     "p1",
			paramIndices: map[gcstypes.EntityID]int{"p1": 0},
			numEqs:       2,
			perturb: func(rng *rand.Rand) []float64 {
				return []float64{
					1.0 + (rng.Float64()-0.5)*2.0,
					2.0 + (rng.Float64()-0.5)*2.0,
				}
			},
		},
		{
			name: "FixedLine",
			entities: []*schema.Entity{
				{
					Id: "l1_p1",
					EntityType: &schema.Entity_Point{
						Point: &schema.PointEntity{X: 1.0, Y: 2.0},
					},
				},
				{
					Id: "l1_p2",
					EntityType: &schema.Entity_Point{
						Point: &schema.PointEntity{X: 3.0, Y: 4.0},
					},
				},
				{
					Id: "l1",
					EntityType: &schema.Entity_Line{
						Line: &schema.LineEntity{P1Id: "l1_p1", P2Id: "l1_p2"},
					},
				},
			},
			constraint: &schema.Constraint{
				Id: "c1",
				ConstraintType: &schema.Constraint_Fixed{
					Fixed: &schema.FixedConstraint{
						EntityId: "l1",
					},
				},
			},
			targetID:     "l1",
			paramIndices: map[gcstypes.EntityID]int{"l1_p1": 0, "l1_p2": 2},
			numEqs:       4,
			perturb: func(rng *rand.Rand) []float64 {
				return []float64{
					1.0 + (rng.Float64()-0.5)*2.0,
					2.0 + (rng.Float64()-0.5)*2.0,
					3.0 + (rng.Float64()-0.5)*2.0,
					4.0 + (rng.Float64()-0.5)*2.0,
				}
			},
		},
		{
			name: "FixedCircle",
			entities: []*schema.Entity{
				{
					Id: "c1_center",
					EntityType: &schema.Entity_Point{
						Point: &schema.PointEntity{X: 1.0, Y: 2.0},
					},
				},
				{
					Id: "c1",
					EntityType: &schema.Entity_Circle{
						Circle: &schema.CircleEntity{CenterId: "c1_center", R: 3.0},
					},
				},
			},
			constraint: &schema.Constraint{
				Id: "c1",
				ConstraintType: &schema.Constraint_Fixed{
					Fixed: &schema.FixedConstraint{
						EntityId: "c1",
					},
				},
			},
			targetID:     "c1",
			paramIndices: map[gcstypes.EntityID]int{"c1_center": 0, "c1": 2},
			numEqs:       1,
			perturb: func(rng *rand.Rand) []float64 {
				return []float64{
					1.0 + (rng.Float64()-0.5)*2.0,
					2.0 + (rng.Float64()-0.5)*2.0,
					3.0 + (rng.Float64()-0.5)*2.0,
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scenario := &schema.Sketch{
				Entities:    tt.entities,
				Constraints: []*schema.Constraint{tt.constraint},
			}

			sys, err := core.NewConstraintSystem(scenario)
			if err != nil {
				t.Fatalf("NewConstraintSystem failed: %v", err)
			}

			entityMap := make(map[gcstypes.EntityID]*schema.Entity)
			for _, ent := range tt.entities {
				entityMap[gcstypes.EntityID(ent.Id)] = ent
			}

			eval, err := constraints.NewEvaluator(tt.constraint, entityMap)
			if err != nil {
				t.Fatalf("failed to create evaluator: %v", err)
			}

			je, ok := eval.(constraints.JacobianEvaluator)
			if !ok {
				t.Fatalf("evaluator does not implement JacobianEvaluator")
			}

			rng := rand.New(rand.NewSource(42))
			n := sys.NumVars()
			m := je.NumEquations()

			if m != tt.numEqs {
				t.Errorf("expected %d equations, got %d", tt.numEqs, m)
			}

			for k := 0; k < 10; k++ {
				x := tt.perturb(rng)

				valExpected := sys.Objective(x)
				gradExpected := make([]float64, n)
				sys.ObjectiveGradient(gradExpected, x)

				gradActual := make([]float64, n)
				valActual := eval.Evaluate(x, gradActual, tt.paramIndices)

				if math.Abs(valActual-valExpected) > 1e-9 {
					t.Errorf("[%d] Evaluate value mismatch: got %f, want %f", k, valActual, valExpected)
				}

				for i := range gradExpected {
					if math.Abs(gradActual[i]-gradExpected[i]) > 1e-9 {
						t.Errorf("[%d] Evaluate gradient mismatch at %d: got %f, want %f", k, i, gradActual[i], gradExpected[i])
					}
				}

				residuals := make([]float64, m)
				J := mat.NewDense(m, n, nil)
				je.EvaluateJacobian(x, residuals, J, 0, tt.paramIndices)

				resSqSum := 0.0
				for _, r := range residuals {
					resSqSum += r * r
				}
				if math.Abs(resSqSum-valActual) > 1e-9 {
					t.Errorf("[%d] Jacobian residuals sum of squares %f does not match Evaluate value %f", k, resSqSum, valActual)
				}

				f := func(dst, xs []float64) {
					je.EvaluateJacobian(xs, dst, nil, 0, tt.paramIndices)
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
		})
	}
}
