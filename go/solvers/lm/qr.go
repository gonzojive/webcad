package lm

import (
	"math"

	"gonum.org/v1/gonum/blas"
	"gonum.org/v1/gonum/blas/blas64"
	"gonum.org/v1/gonum/lapack/lapack64"
	"gonum.org/v1/gonum/mat"
)

// solveQRAugmented calculates the next optimization step (dx) using QR decomposition
// on an augmented system.
//
// In geometric constraint solving, we want to find a step dx that solves the damped
// least-squares problem:
//     (JᵀJ + μI) dx = -Jᵀf
//
// When the system is near-singular (e.g., when constraints conflict or are redundant),
// solving this via normal equations (Cholesky) can be numerically unstable.
// Instead, this function reformulates it as an augmented least-squares problem:
//     Minimize || A_aug * dx - b_aug ||₂
// where:
//     A_aug = [ J ; √μ * I ]  (Jacobian stacked on top of scaled Identity matrix)
//     b_aug = [ -f ; 0 ]      (Negative residuals stacked on top of zeros)
//
// This formulation is numerically much more stable and is solved using QR decomposition:
//     1. Decompose A_aug = Q * R
//     2. Compute Qᵀ * b_aug
//     3. Solve the upper triangular system R * dx = (Qᵀ * b_aug)₁..n using back-substitution.
//
// To achieve high performance in interactive loops, this function performs all operations
// in-place using pre-allocated workspace memory and direct LAPACK/BLAS calls, resulting
// in zero heap allocations.
//
// Parameters:
//   J:            The m x n Jacobian matrix evaluated at the current state.
//   f:            The m-dimensional residual vector at the current state.
//   mu:           The current Levenberg-Marquardt damping factor (μ). Larger values make
//                 the step closer to gradient descent, smaller values closer to Gauss-Newton.
//   aAug:         Pre-allocated (m+n) x n matrix used to construct the augmented matrix A_aug.
//                 Will be overwritten with the QR factorization.
//   bAug:         Pre-allocated (m+n)-dimensional vector used to construct b_aug.
//                 Will be overwritten with Qᵀ * b_aug.
//   dx:           The target n-dimensional vector where the computed step will be written.
//   tau:          Pre-allocated n-dimensional slice used by LAPACK Geqrf to store scalar
//                 factors of elementary reflectors.
//   work:         Pre-allocated workspace slice for LAPACK Geqrf and Ormqr. Size should be
//                 queried using LAPACK workspace query (see SolverWorkspace.Reset).
func solveQRAugmented(
	J *mat.Dense,
	f *mat.VecDense,
	mu float64,
	aAug *mat.Dense,
	bAug *mat.VecDense,
	dx *mat.VecDense,
	tau []float64,
	work []float64,
) {
	m, n := J.Dims()
	sqrtMu := math.Sqrt(mu)

	aRaw := aAug.RawMatrix()
	jRaw := J.RawMatrix()

	// 1. Construct A_aug = [ J ; sqrt(μ)*I ] in-place without Slice() allocations
	for r := 0; r < m; r++ {
		copy(aRaw.Data[r*aRaw.Stride:r*aRaw.Stride+n], jRaw.Data[r*jRaw.Stride:r*jRaw.Stride+n])
	}
	for r := 0; r < n; r++ {
		rowStart := (m + r) * aRaw.Stride
		for c := 0; c < n; c++ {
			if r == c {
				aRaw.Data[rowStart+c] = sqrtMu
			} else {
				aRaw.Data[rowStart+c] = 0.0
			}
		}
	}

	// 2. Construct b_aug = [ -f ; 0 ]
	bRaw := bAug.RawVector()
	fRaw := f.RawVector()
	for i := 0; i < m; i++ {
		bRaw.Data[i*bRaw.Inc] = -fRaw.Data[i*fRaw.Inc]
	}
	for i := m; i < m+n; i++ {
		bRaw.Data[i*bRaw.Inc] = 0.0
	}

	// 3. Compute QR factorization of A_aug in-place
	lapack64.Geqrf(aRaw, tau, work, len(work))

	// 4. Apply Qᵀ to b_aug: b_aug = Qᵀ * b_aug
	bAugMat := blas64.General{
		Rows:   m + n,
		Cols:   1,
		Stride: bRaw.Inc,
		Data:   bRaw.Data,
	}
	lapack64.Ormqr(
		blas.Left,
		blas.Trans,
		aRaw,
		tau,
		bAugMat,
		work,
		len(work),
	)

	// 5. Solve the upper triangular system R * dx = Qᵀ * b_aug (first n elements)
	dxRaw := dx.RawVector()
	copy(dxRaw.Data, bRaw.Data[:n]) // Fast memmove copy

	// Correctly construct a blas64.Triangular view of the R block and call Trsv
	blas64.Trsv(
		blas.NoTrans,
		blas64.Triangular{
			Uplo:   blas.Upper,
			Diag:   blas.NonUnit,
			N:      n,
			Stride: aRaw.Stride,
			Data:   aRaw.Data,
		},
		dxRaw,
	)
}
