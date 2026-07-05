package lm

import (
	"math"
	"testing"

	"github.com/gonzojive/webcad/go/solvers/core"
	"github.com/gonzojive/webcad/proto"
	"gonum.org/v1/gonum/lapack/lapack64"
	"gonum.org/v1/gonum/mat"
)

func TestLMSolverConvergence(t *testing.T) {
	tests := []struct {
		name     string
		scenario *schema.Sketch
		assert   func(*testing.T, *schema.SolveResult)
	}{
		{
			name: "BasicSanity",
			scenario: &schema.Sketch{
				Id: "basic_sanity",
				Entities: []*schema.Entity{
					{
						Id: "p1",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 0, Y: 0},
						},
					},
					{
						Id: "p2",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 10, Y: 0},
						},
					},
				},
				Constraints: []*schema.Constraint{
					{
						Id: "c1",
						ConstraintType: &schema.Constraint_Distance{
							Distance: &schema.DistanceConstraint{
								EntityA: "p1",
								EntityB: "p2",
								Value:   20,
							},
						},
					},
				},
			},
			assert: func(t *testing.T, res *schema.SolveResult) {
				p1Solved := res.SolvedState.Entities["p1"].GetPoint()
				p2Solved := res.SolvedState.Entities["p2"].GetPoint()
				dist := math.Sqrt(math.Pow(p2Solved.X-p1Solved.X, 2) + math.Pow(p2Solved.Y-p1Solved.Y, 2))
				if math.Abs(dist-20) > 1e-4 {
					t.Errorf("Distance is incorrect! Got %f, expected 20", dist)
				}
			},
		},
		{
			name: "FixedPoint_Distance",
			scenario: &schema.Sketch{
				Id: "fixed_point_dist",
				Entities: []*schema.Entity{
					{
						Id: "p1",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 0, Y: 0},
						},
					},
					{
						Id: "p2",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 10, Y: 0},
						},
					},
				},
				Constraints: []*schema.Constraint{
					{
						Id: "c_fixed",
						ConstraintType: &schema.Constraint_Fixed{
							Fixed: &schema.FixedConstraint{
								EntityId: "p1",
							},
						},
					},
					{
						Id: "c_dist",
						ConstraintType: &schema.Constraint_Distance{
							Distance: &schema.DistanceConstraint{
								EntityA: "p1",
								EntityB: "p2",
								Value:   20,
							},
						},
					},
				},
			},
			assert: func(t *testing.T, res *schema.SolveResult) {
				p1Solved := res.SolvedState.Entities["p1"].GetPoint()
				p2Solved := res.SolvedState.Entities["p2"].GetPoint()
				if math.Abs(p1Solved.X) > 1e-4 || math.Abs(p1Solved.Y) > 1e-4 {
					t.Errorf("Fixed point P1 moved! Got (%f, %f), expected (0,0)", p1Solved.X, p1Solved.Y)
				}
				dist := math.Sqrt(math.Pow(p2Solved.X-p1Solved.X, 2) + math.Pow(p2Solved.Y-p1Solved.Y, 2))
				if math.Abs(dist-20) > 1e-4 {
					t.Errorf("Distance is incorrect! Got %f, expected 20", dist)
				}
			},
		},
		{
			name: "FixedLine_Distance",
			scenario: &schema.Sketch{
				Id: "fixed_line_dist",
				Entities: []*schema.Entity{
					{
						Id: "l1_p1",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 0, Y: 0},
						},
					},
					{
						Id: "l1_p2",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 10, Y: 0},
						},
					},
					{
						Id: "l1",
						EntityType: &schema.Entity_Line{
							Line: &schema.LineEntity{P1Id: "l1_p1", P2Id: "l1_p2"},
						},
					},
					{
						Id: "p2",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 5, Y: 5},
						},
					},
				},
				Constraints: []*schema.Constraint{
					{
						Id: "c_fixed",
						ConstraintType: &schema.Constraint_Fixed{
							Fixed: &schema.FixedConstraint{
								EntityId: "l1",
							},
						},
					},
					{
						Id: "c_dist",
						ConstraintType: &schema.Constraint_Distance{
							Distance: &schema.DistanceConstraint{
								EntityA: "l1",
								EntityB: "p2",
								Value:   10,
							},
						},
					},
				},
			},
			assert: func(t *testing.T, res *schema.SolveResult) {
				p1Solved := res.SolvedState.Entities["l1_p1"].GetPoint()
				p2Solved := res.SolvedState.Entities["l1_p2"].GetPoint()
				p2_Solved := res.SolvedState.Entities["p2"].GetPoint()
				if math.Abs(p1Solved.X) > 1e-4 || math.Abs(p1Solved.Y) > 1e-4 ||
					math.Abs(p2Solved.X-10) > 1e-4 || math.Abs(p2Solved.Y) > 1e-4 {
					t.Errorf("Fixed line L1 endpoints moved! Got (%f,%f) and (%f,%f), expected (0,0) and (10,0)",
						p1Solved.X, p1Solved.Y, p2Solved.X, p2Solved.Y)
				}
				if math.Abs(math.Abs(p2_Solved.Y)-10) > 1e-4 {
					t.Errorf("Distance to line is incorrect! P2.Y = %f, expected 10 or -10", p2_Solved.Y)
				}
			},
		},
		{
			name: "ConcentricCircles",
			scenario: &schema.Sketch{
				Id: "concentric_circles",
				Entities: []*schema.Entity{
					{
						Id: "p1",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 0, Y: 0},
						},
					},
					{
						Id: "c1_center",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 5, Y: 5},
						},
					},
					{
						Id: "c1",
						EntityType: &schema.Entity_Circle{
							Circle: &schema.CircleEntity{CenterId: "c1_center", R: 3},
						},
					},
					{
						Id: "c2_center",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 10, Y: 10},
						},
					},
					{
						Id: "c2",
						EntityType: &schema.Entity_Circle{
							Circle: &schema.CircleEntity{CenterId: "c2_center", R: 5},
						},
					},
				},
				Constraints: []*schema.Constraint{
					{
						Id: "c_fixed",
						ConstraintType: &schema.Constraint_Fixed{
							Fixed: &schema.FixedConstraint{
								EntityId: "p1",
							},
						},
					},
					{
						Id: "c_concentric_p1_c1",
						ConstraintType: &schema.Constraint_Concentric{
							Concentric: &schema.ConcentricConstraint{
								EntityA: "p1",
								EntityB: "c1",
							},
						},
					},
					{
						Id: "c_concentric_c1_c2",
						ConstraintType: &schema.Constraint_Concentric{
							Concentric: &schema.ConcentricConstraint{
								EntityA: "c1",
								EntityB: "c2",
							},
						},
					},
				},
			},
			assert: func(t *testing.T, res *schema.SolveResult) {
				c1CenterSolved := res.SolvedState.Entities["c1_center"].GetPoint()
				c2CenterSolved := res.SolvedState.Entities["c2_center"].GetPoint()
				if math.Abs(c1CenterSolved.X) > 1e-4 || math.Abs(c1CenterSolved.Y) > 1e-4 {
					t.Errorf("Circle c1 center is incorrect! Got (%f, %f), expected (0,0)", c1CenterSolved.X, c1CenterSolved.Y)
				}
				if math.Abs(c2CenterSolved.X) > 1e-4 || math.Abs(c2CenterSolved.Y) > 1e-4 {
					t.Errorf("Circle c2 center is incorrect! Got (%f, %f), expected (0,0)", c2CenterSolved.X, c2CenterSolved.Y)
				}
			},
		},
		{
			name: "TangentCircles",
			scenario: &schema.Sketch{
				Id: "tangent_circles",
				Entities: []*schema.Entity{
					{
						Id: "c1_center",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 0, Y: 0},
						},
					},
					{
						Id: "c1",
						EntityType: &schema.Entity_Circle{
							Circle: &schema.CircleEntity{CenterId: "c1_center", R: 5},
						},
					},
					{
						Id: "c2_center",
						EntityType: &schema.Entity_Point{
							Point: &schema.PointEntity{X: 10, Y: 0},
						},
					},
					{
						Id: "c2",
						EntityType: &schema.Entity_Circle{
							Circle: &schema.CircleEntity{CenterId: "c2_center", R: 5},
						},
					},
				},
				Constraints: []*schema.Constraint{
					{
						Id: "c_t",
						ConstraintType: &schema.Constraint_Tangent{
							Tangent: &schema.TangentConstraint{
								EntityA: "c1",
								EntityB: "c2",
							},
						},
					},
				},
			},
			assert: func(t *testing.T, res *schema.SolveResult) {
				c1CenterSolved := res.SolvedState.Entities["c1_center"].GetPoint()
				c2CenterSolved := res.SolvedState.Entities["c2_center"].GetPoint()
				c1Solved := res.SolvedState.Entities["c1"].GetCircle()
				c2Solved := res.SolvedState.Entities["c2"].GetCircle()
				dist := math.Sqrt(math.Pow(c2CenterSolved.X-c1CenterSolved.X, 2) + math.Pow(c2CenterSolved.Y-c1CenterSolved.Y, 2))
				sumR := c1Solved.R + c2Solved.R
				if math.Abs(dist-sumR) > 1e-4 {
					t.Errorf("Circles are not tangent! Distance=%f, sum of radiuses=%f", dist, sumR)
				}
			},
		},
	}

	solver := New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := solver.Solve(tt.scenario)
			if err != nil {
				t.Fatalf("Solve failed: %v", err)
			}
			if !res.Success {
				t.Fatalf("Solve did not succeed: %s", res.ErrorMessage)
			}
			tt.assert(t, res)
		})
	}
}

func TestLMSolverZeroAllocations(t *testing.T) {
	// Setup the same scenario
	p1 := &schema.Entity{
		Id: "p1",
		EntityType: &schema.Entity_Point{
			Point: &schema.PointEntity{X: 1.0, Y: 2.0},
		},
	}
	p2 := &schema.Entity{
		Id: "p2",
		EntityType: &schema.Entity_Point{
			Point: &schema.PointEntity{X: 3.0, Y: 4.0},
		},
	}
	cFixed := &schema.Constraint{
		Id: "c_fixed",
		ConstraintType: &schema.Constraint_Fixed{
			Fixed: &schema.FixedConstraint{
				EntityId: "p1",
			},
		},
	}
	cConcentric := &schema.Constraint{
		Id: "c_concentric",
		ConstraintType: &schema.Constraint_Concentric{
			Concentric: &schema.ConcentricConstraint{
				EntityA: "p1",
				EntityB: "p2",
			},
		},
	}
	scenario := &schema.Sketch{
		Entities:    []*schema.Entity{p1, p2},
		Constraints: []*schema.Constraint{cFixed, cConcentric},
	}

	solver := New()
	sys, err := core.NewConstraintSystem(scenario)
	if err != nil {
		t.Fatalf("NewConstraintSystem failed: %v", err)
	}
	x := sys.ExtractVariables()
	initialX := make([]float64, len(x))
	copy(initialX, x)

	// Warm up the solver (pre-allocates workspace in the pool)
	_, _ = solver.solve(sys, x)

	// Measure allocations of the core solve loop
	allocs := testing.AllocsPerRun(100, func() {
		copy(x, initialX)
		_, _ = solver.solve(sys, x)
	})

	if allocs > 0 {
		t.Errorf("expected 0 allocations in solver loop, got %f", allocs)
	} else {
		t.Logf("Verified 0 heap allocations in the solver hot loop!")
	}
}

func TestQRSolver(t *testing.T) {
	// Construct a simple J and f to solve (JᵀJ + μI) dx = -Jᵀf
	J := mat.NewDense(2, 2, []float64{
		2, 1,
		1, 3,
	})
	f := mat.NewVecDense(2, []float64{5, 1})
	mu := 0.1
	n := 2
	m := 2

	// 1. Compute expected solution using Gonum's standard Cholesky on normal equations
	var JT mat.Dense
	JT.CloneFrom(J.T())
	var JTJ mat.Dense
	JTJ.Mul(&JT, J)

	H := mat.NewSymDense(n, nil)
	for r := 0; r < n; r++ {
		for c := 0; c < n; c++ {
			val := JTJ.At(r, c)
			if r == c {
				val += mu
			}
			H.SetSym(r, c, val)
		}
	}

	var g mat.VecDense
	g.MulVec(&JT, f)

	var chol mat.Cholesky
	if ok := chol.Factorize(H); !ok {
		t.Fatalf("Cholesky factorization failed")
	}
	var dxExpected mat.VecDense
	var negG mat.VecDense
	negG.ScaleVec(-1.0, &g)
	if err := chol.SolveVecTo(&dxExpected, &negG); err != nil {
		t.Fatalf("Cholesky solve failed: %v", err)
	}

	// 2. Solve using our 100% allocation-free solveQRAugmented
	aAug := mat.NewDense(m+n, n, nil)
	bAug := mat.NewVecDense(m+n, nil)
	dxActual := mat.NewVecDense(n, nil)
	tau := make([]float64, n)

	// Query work size
	workQuery := []float64{0}
	lapack64.Geqrf(aAug.RawMatrix(), tau, workQuery, -1)
	lwork := int(workQuery[0])
	work := make([]float64, lwork)

	// Call our QR solver
	solveQRAugmented(J, f, mu, aAug, bAug, dxActual, tau, work)

	// 3. Verify results match
	for i := 0; i < n; i++ {
		diff := math.Abs(dxActual.AtVec(i) - dxExpected.AtVec(i))
		if diff > 1e-12 {
			t.Errorf("expected dx[%d] = %f, got %f (diff: %e)", i, dxExpected.AtVec(i), dxActual.AtVec(i), diff)
		}
	}
}

func TestLMSolverImpossiblePointLineDistance(t *testing.T) {
	sketch := &schema.Sketch{
		Id: "impossible_pt_ln",
		Entities: []*schema.Entity{
			{Id: "P1", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 268.12164427779163, Y: 290.35924855450537}}},
			{Id: "P2", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 401.3390256842887, Y: 430.7363636363636}}},
			{Id: "P3", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 388.00000000000006, Y: 167.99999999999997}}},
			{Id: "P4", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 603, Y: 405}}},
			{Id: "L1", EntityType: &schema.Entity_Line{Line: &schema.LineEntity{P1Id: "P3", P2Id: "P4"}}},
			{Id: "L2", EntityType: &schema.Entity_Line{Line: &schema.LineEntity{P1Id: "P2", P2Id: "P4"}}},
			{Id: "L3", EntityType: &schema.Entity_Line{Line: &schema.LineEntity{P1Id: "P1", P2Id: "P2"}}},
			{Id: "L4", EntityType: &schema.Entity_Line{Line: &schema.LineEntity{P1Id: "P1", P2Id: "P3"}}},
		},
		Constraints: []*schema.Constraint{
			{
				Id: "Perp_L4_L1",
				ConstraintType: &schema.Constraint_Perpendicular{
					Perpendicular: &schema.PerpendicularConstraint{LineA: "L4", LineB: "L1"},
				},
			},
			{
				Id: "PointLineDist_P4_L2",
				ConstraintType: &schema.Constraint_Distance{
					Distance: &schema.DistanceConstraint{EntityA: "P4", EntityB: "L2", Value: 4},
				},
			},
			{
				Id: "Distance_P4_P1",
				ConstraintType: &schema.Constraint_Distance{
					Distance: &schema.DistanceConstraint{EntityA: "P4", EntityB: "P1", Value: 30},
				},
			},
			{
				Id: "fixed-P4",
				ConstraintType: &schema.Constraint_Fixed{
					Fixed: &schema.FixedConstraint{EntityId: "P4"},
				},
			},
		},
	}

	solver := New()
	res, err := solver.Solve(sketch)
	if err != nil {
		t.Fatalf("Solve failed with system error: %v", err)
	}

	if res.Success {
		t.Fatalf("Expected solver to fail on impossible system, but it succeeded!")
	}

	t.Logf("Solver failed as expected: %s", res.ErrorMessage)
	t.Logf("Final residual: %e", res.Telemetry.FinalResidual)

	if math.Abs(res.Telemetry.FinalResidual-256.0) > 1e-4 {
		t.Errorf("Expected final residual to be around 256.0, got %f", res.Telemetry.FinalResidual)
	}
}

func TestLMSolverStalledSuccess(t *testing.T) {
	// Create a simple consistent system: two points with a distance constraint.
	sketch := &schema.Sketch{
		Id: "stalled_success_test",
		Entities: []*schema.Entity{
			{Id: "P1", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 0, Y: 0}}},
			{Id: "P2", EntityType: &schema.Entity_Point{Point: &schema.PointEntity{X: 10, Y: 0}}},
		},
		Constraints: []*schema.Constraint{
			{
				Id: "fixed_P1",
				ConstraintType: &schema.Constraint_Fixed{
					Fixed: &schema.FixedConstraint{EntityId: "P1"},
				},
			},
			{
				Id: "dist_P1_P2",
				ConstraintType: &schema.Constraint_Distance{
					Distance: &schema.DistanceConstraint{EntityA: "P1", EntityB: "P2", Value: 20},
				},
			},
		},
	}

	// We configure EpGeom to be impossibly tight (e.g., 1e-25), ensuring
	// the solver cannot satisfy the strict convergence check due to machine precision.
	// But since the system is consistent, it will reach a residual of ~0, stall,
	// and should be tolerated as a Success.
	solver := New()
	solver.EpGeom = 1e-25
	solver.EpGrad = 1e-20
	solver.EpStep = 1e-8 // Relaxed step tolerance to trigger stall early

	res, err := solver.Solve(sketch)
	if err != nil {
		t.Fatalf("Solve failed: %v", err)
	}

	if !res.Success {
		t.Fatalf("Expected solver to tolerate the stall and succeed, but it failed! Error: %s", res.ErrorMessage)
	}

	t.Logf("Solver successfully tolerated stall. Telemetry final residual: %e", res.Telemetry.FinalResidual)
}

