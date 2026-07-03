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
A method for representing 3D solid shapes in computer-aided design by defining the limits of their spatial boundaries. A B-Rep model consists of topological elements (faces, edges, vertices) and geometric elements (surfaces, curves, points) that describe the outer shell of the object. (See [Boundary representation on Wikipedia](https://en.wikipedia.org/wiki/Boundary_representation).)

### Constructive solid geometry (CSG)
A solid modeling technique where complex 3D shapes are constructed from simpler primitives (such as blocks, cylinders, spheres, cones) using boolean operations (union, intersection, subtraction). (See [Constructive solid geometry on Wikipedia](https://en.wikipedia.org/wiki/Constructive_solid_geometry).)

### Constructive solver
A geometric constraint solver that analyzes the dependency graph of constraints to solve the system using a sequence of analytical, ruler-and-compass geometric constructions.

### Degrees of freedom (DoF)
The number of independent parameters or coordinates that define the configuration of a geometric sketch or system. In parametric sketching:
- **Under-constrained** sketches have more degrees of freedom than constraints (DoF > 0).
- **Fully-constrained** sketches have zero degrees of freedom (DoF = 0), ensuring the geometry is mathematically locked.
- **Over-constrained** sketches contain redundant or conflicting constraints (DoF < 0).

(See [Degrees of freedom (mechanics) on Wikipedia](https://en.wikipedia.org/wiki/Degrees_of_freedom_(mechanics)).)

### Geometric constraint solver (GCS)
A mathematical engine that translates geometric relations (such as tangency, parallelism, dimensions, coincidence) between sketch entities into systems of algebraic equations, and solves them to compute the coordinates of the drawing elements. (See [Geometric constraint solving on Wikipedia](https://en.wikipedia.org/wiki/Geometric_constraint_solving).)

### Numerical solver
An iterative mathematical engine (often using algorithms like Newton-Raphson or Levenberg-Marquardt) that finds approximate roots of non-linear constraint equations. It is highly flexible and handles complex, simultaneous constraint equations, but relies on a good initial estimate to converge. (See [Newton's method for non-linear equations on Wikipedia](https://en.wikipedia.org/wiki/Newton%27s_method#Nonlinear_systems_of_equations).)

### Parametric design
A design methodology where geometric models are defined by parameters, expressions, and relationships (constraints) rather than fixed coordinates, allowing changes in one dimension to automatically propagate throughout the model. (See [Parametric design on Wikipedia](https://en.wikipedia.org/wiki/Parametric_design).)

### Technical drawing
A precise, standardized drawing or blueprint (often containing orthographic views, dimensions, annotations, and tolerances) used to convey engineering specifications and manufacturing requirements for a physical part. (See [Technical drawing on Wikipedia](https://en.wikipedia.org/wiki/Technical_drawing).)
