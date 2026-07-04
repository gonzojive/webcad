package gcstypes

// EntityID uniquely identifies a geometric entity (e.g., point, line, circle)
// within a sketch.
type EntityID string

// ConstraintID uniquely identifies a constraint within a sketch.
type ConstraintID string

// SketchID uniquely identifies a sketch.
type SketchID string

// SolverID uniquely identifies a solver implementation (e.g., "lm", "bfgs").
type SolverID string

// ConstraintResidual represents the absolute residual error of a constraint.
// It is a unitless number with a magnitude that depends on the constraint's
// definition and weights.
type ConstraintResidual float64
