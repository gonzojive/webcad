package lm

import (
	"math"

	"github.com/gonzojive/webcad/go/solvers/core"
	"gonum.org/v1/gonum/blas"
	"gonum.org/v1/gonum/blas/blas64"
	"gonum.org/v1/gonum/lapack/lapack64"
	"gonum.org/v1/gonum/mat"
)

// solve runs the core Levenberg-Marquardt optimization loop.
//
// The Levenberg-Marquardt (LM) algorithm is an iterative technique that finds the minimum
// of a sum of squared non-linear functions (least squares). It interpolates between
// the Gauss-Newton algorithm and the method of gradient descent.
//
// At each iteration, the solver:
//  1. Evaluates residuals (f) and the Jacobian (J).
//  2. Checks for convergence based on residual magnitude (EpGeom).
//  3. Computes the gradient (g = Jᵀf) and checks for local minima (EpGrad).
//  4. Approximates the Hessian (H ≈ JᵀJ or H_dual ≈ JJᵀ for under-constrained systems).
//  5. Solves the damped system (H + μI) dx = -g (or dual equivalent) to find step dx.
//     - First tries fast Cholesky decomposition.
//     - Falls back to numerically stable QR decomposition of augmented matrix if Cholesky fails.
//  6. Checks if step size is too small (EpStep).
//  7. Evaluates the candidate state (x + dx) and computes the "gain ratio" (ρ) between
//     actual residual reduction and predicted reduction.
//  8. If ρ > 0, the step is accepted, x is updated, and damping μ is decreased.
//     Otherwise, the step is rejected, x remains unchanged, μ is increased, and we retry.
//
// This function is designed for zero heap allocations in the hot loop.
//
// Parameters:
//   sys:  The GCS ConstraintSystem representing the sketch's constraints and variables.
//         It provides the Objective, EvaluateJacobian, and UpdateSketch methods.
//   x:    The starting parameter vector (extracted from the sketch). This slice is
//         mutated in-place and will contain the optimized parameters upon success.
//
// Returns:
//   []float64:   The optimized parameter slice (same backing array as input `x`).
//   solveResult: Telemetry and status of the solver run (iterations, evaluations, etc.).
func (s *LMSolver) solve(sys *core.ConstraintSystem, x []float64) ([]float64, solveResult) {
	n := len(x)
	m := sys.NumEquations()
	useDual := m < n // Dual formulation is faster when we have fewer constraints than variables

	// Retrieve pre-allocated workspace from the solver pool
	w := s.pool.Get().(*SolverWorkspace)
	defer s.pool.Put(w)
	w.Reset(m, n)

	// Copy initial state to workspace
	copy(w.X, x)

	// Damping parameters (standard LM update)
	mu := 1e-3
	nu := 2.0

	funcEvals := 0
	gradEvals := 0
	iterations := 0

	for iter := 0; iter < s.MaxIter; iter++ {
		iterations++

		// Evaluate residuals and Jacobian at current state
		sys.EvaluateJacobian(w.X, w.F.RawVector().Data, w.J)
		funcEvals++
		gradEvals++

		// Convergence Check: if infinity norm of residuals is below tolerance, success
		// ||f(x)||∞ < ε_geom
		if normInf(w.F) < s.EpGeom {
			copy(x, w.X) // Copy back to caller's slice to prevent memory aliasing
			return x, solveResult{
				status:          Success,
				iterations:      iterations,
				funcEvaluations: funcEvals,
				gradEvaluations: gradEvals,
				finalResidual:   blas64.Dot(w.F.RawVector(), w.F.RawVector()),
			}
		}

		// Compute Gradient: g = Jᵀ * f
		blas64.Gemv(blas.Trans, 1.0, w.J.RawMatrix(), w.F.RawVector(), 0.0, w.G.RawVector())

		// Local Minimum Check: if gradient is flat, we are stuck in a local minimum
		// ||g||∞ < ε_grad
		if normInf(w.G) < s.EpGrad {
			copy(x, w.X)
			return x, solveResult{
				status:          Inconsistent, // Over-constrained or consistent local minimum
				iterations:      iterations,
				funcEvaluations: funcEvals,
				gradEvaluations: gradEvals,
				finalResidual:   blas64.Dot(w.F.RawVector(), w.F.RawVector()),
			}
		}

		// Compute symmetric outer product (Approximate Hessian)
		// Primal: H = Jᵀ * J
		// Dual:   H_dual = J * Jᵀ
		if useDual {
			blas64.Syrk(blas.NoTrans, 1.0, w.J.RawMatrix(), 0.0, w.Jjt.RawSymmetric())
		} else {
			blas64.Syrk(blas.Trans, 1.0, w.J.RawMatrix(), 0.0, w.Hres.RawSymmetric())
		}

		stepAccepted := false
		for !stepAccepted {
			choleskyOK := false

			if useDual {
				// Solve dual system: (J*Jᵀ + μI) * z = -f(x)
				w.JjtDamped.CopySym(w.Jjt)
				jjtDampedRaw := w.JjtDamped.RawSymmetric()
				for i := 0; i < m; i++ {
					jjtDampedRaw.Data[i*jjtDampedRaw.Stride+i] += mu
				}

				// Try solving via Cholesky decomposition
				t, ok := lapack64.Potrf(jjtDampedRaw)
				if ok {
					w.Z.ScaleVec(-1.0, w.F)
					zMat := blas64.General{
						Rows:   m,
						Cols:   1,
						Stride: 1,
						Data:   w.Z.RawVector().Data,
					}
					lapack64.Potrs(t, zMat)
					// Compute step: dx = Jᵀ * z
					blas64.Gemv(blas.Trans, 1.0, w.J.RawMatrix(), w.Z.RawVector(), 0.0, w.Dx.RawVector())
					choleskyOK = true
				}
			} else {
				// Solve primal system: (Jᵀ*J + μI) * dx = -g
				w.HresDamped.CopySym(w.Hres)
				hresDampedRaw := w.HresDamped.RawSymmetric()
				for i := 0; i < n; i++ {
					hresDampedRaw.Data[i*hresDampedRaw.Stride+i] += mu
				}

				// Try solving via Cholesky decomposition
				t, ok := lapack64.Potrf(hresDampedRaw)
				if ok {
					w.Dx.ScaleVec(-1.0, w.G)
					dxMat := blas64.General{
						Rows:   n,
						Cols:   1,
						Stride: 1,
						Data:   w.Dx.RawVector().Data,
					}
					lapack64.Potrs(t, dxMat)
					choleskyOK = true
				}
			}

			// Fallback to QR decomposition of augmented matrix if Cholesky failed.
			// Augmented QR is numerically much more stable than normal equations, especially
			// near singular states (common in CAD when constraints conflict).
			if !choleskyOK {
				solveQRAugmented(w.J, w.F, mu, w.AAug, w.BAug, w.Dx, w.Tau, w.Work)
			}

			// Step Tolerance Check: if step size is too small, solver has stalled.
			// ||dx||∞ < ε_step * (1 + ||x||∞)
			if normInf(w.Dx) < s.EpStep*(1.0+normInfSlice(w.X)) {
				copy(x, w.X)
				return x, solveResult{
					status:          Stalled,
					iterations:      iterations,
					funcEvaluations: funcEvals,
					gradEvaluations: gradEvals,
					finalResidual:   blas64.Dot(w.F.RawVector(), w.F.RawVector()),
				}
			}

			// Evaluate candidate state: x_new = x + dx
			for i := 0; i < n; i++ {
				w.XNew[i] = w.X[i] + w.Dx.AtVec(i)
			}
			sys.EvaluateJacobian(w.XNew, w.FNew.RawVector().Data, nil)
			funcEvals++

			// Compute Gain Ratio (ρ) to determine if step should be accepted.
			// ρ = (actual reduction) / (predicted reduction)
			dxRaw := w.Dx.RawVector()
			actualRed := 0.5 * (blas64.Dot(w.F.RawVector(), w.F.RawVector()) - blas64.Dot(w.FNew.RawVector(), w.FNew.RawVector()))
			predRed := 0.5 * (mu*blas64.Dot(dxRaw, dxRaw) - blas64.Dot(dxRaw, w.G.RawVector()))

			rho := 0.0
			if predRed > 0 {
				rho = actualRed / predRed
			}

			// Step acceptance logic
			if rho > 0 {
				// Accept step
				copy(w.X, w.XNew)
				w.F.CopyVec(w.FNew) // w.F keeps track of residuals at w.X
				
				// Decrease damping factor
				temp := 2.0*rho - 1.0
				mu *= math.Max(1.0/3.0, 1.0-temp*temp*temp)
				nu = 2.0
				stepAccepted = true
			} else {
				// Reject step, increase damping factor and retry
				mu *= nu
				nu *= 2.0
			}
		}
	}

	copy(x, w.X)
	return x, solveResult{
		status:          MaxIterationsExceeded,
		iterations:      s.MaxIter,
		funcEvaluations: funcEvals,
		gradEvaluations: gradEvals,
		finalResidual:   blas64.Dot(w.F.RawVector(), w.F.RawVector()),
	}
}

// normInf returns the L-infinity norm of a Vector (maximum absolute value).
// Optimized to bypass Gonum's boundary checks by reading slice memory directly.
func normInf(v *mat.VecDense) float64 {
	raw := v.RawVector()
	max := 0.0
	for i := 0; i < raw.N; i++ {
		abs := math.Abs(raw.Data[i*raw.Inc])
		if abs > max {
			max = abs
		}
	}
	return max
}

// normInfSlice returns the L-infinity norm of a float64 slice.
func normInfSlice(v []float64) float64 {
	max := 0.0
	for _, val := range v {
		abs := math.Abs(val)
		if abs > max {
			max = abs
		}
	}
	return max
}
