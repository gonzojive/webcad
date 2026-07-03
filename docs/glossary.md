# Glossary

This document serves as a centralized glossary for the webcad project. Other project documentation should link directly to individual definitions within this file.

## How to Add to the Glossary
When defining a new technical term, architectural component, or project-specific concept:
1. Add the term as a third-level heading (`### Term Name`).
2. Provide a clear, concise definition.
3. Keep terms in alphabetical order.

---

<!-- Term definitions should be added below this line by agents as needed -->

### Boundary representation (B-Rep)
A method for representing 3D solid shapes in computer-aided design by defining the limits of their spatial boundaries. A B-Rep model consists of topological elements (faces, edges, vertices) and geometric elements (surfaces, curves, points) that describe the outer shell of the object.

### Constructive solid geometry (CSG)
A solid modeling technique where complex 3D shapes are constructed from simpler primitives (such as blocks, cylinders, spheres, cones) using boolean operations (union, intersection, subtraction).

### Constructive solver
A geometric constraint solver that analyzes the dependency graph of constraints to solve the system using a sequence of analytical, ruler-and-compass geometric constructions.

### Degrees of freedom (DoF)
The number of independent parameters or coordinates that define the configuration of a geometric sketch or system. In parametric sketching:
- **Under-constrained** sketches have more degrees of freedom than constraints (DoF > 0).
- **Fully-constrained** sketches have zero degrees of freedom (DoF = 0), ensuring the geometry is mathematically locked.
- **Over-constrained** sketches contain redundant or conflicting constraints (DoF < 0).

### Geometric constraint solver (GCS)
A mathematical engine that translates geometric relations (such as tangency, parallelism, dimensions, coincidence) between sketch entities into systems of algebraic equations, and solves them to compute the coordinates of the drawing elements.

### Numerical solver
An iterative mathematical engine (often using algorithms like Newton-Raphson or Levenberg-Marquardt) that finds approximate roots of non-linear constraint equations. It is highly flexible and handles complex, simultaneous constraint equations, but relies on a good initial estimate to converge.

### Parametric design
A design methodology where geometric models are defined by parameters, expressions, and relationships (constraints) rather than fixed coordinates, allowing changes in one dimension to automatically propagate throughout the model.

### Technical drawing
A precise, standardized drawing or blueprint (often containing orthographic views, dimensions, annotations, and tolerances) used to convey engineering specifications and manufacturing requirements for a physical part.
