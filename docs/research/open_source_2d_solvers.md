# Open-source 2D drawing programs with geometric constraint solvers

This report outlines the landscape of existing open-source 2D drawing and sketching programs that employ [geometric constraint solvers (GCS)](file:///home/red/ws/webcad/docs/glossary.md#geometric-constraint-solver-gcs). It analyzes their architectures, capabilities, and the design paradigms they share with professional industry-standard parametric CAD software (such as SolidWorks or FreeCAD), without focusing on specific commercial web-based offerings.

---

## 1. Understanding geometric constraint solvers (GCS)

In [parametric design](file:///home/red/ws/webcad/docs/glossary.md#parametric-design), a 2D sketch is not just a collection of static vector elements. Instead, it is a dynamic system of geometric primitives (points, lines, arcs, circles, ellipses) governed by a set of mathematical relations called **constraints** (coincidence, parallelism, perpendicularity, tangency, distance, angle, equality, etc.).

A **[geometric constraint solver](file:///home/red/ws/webcad/docs/glossary.md#geometric-constraint-solver-gcs)** is the mathematical engine that takes the current state of these primitives and constraints, translates them into a system of equations (often non-linear), and solves them to find the new positions of all entities.[^1] 

Solvers generally fall into three categories:

1. **[Numerical solvers](file:///home/red/ws/webcad/docs/glossary.md#numerical-solver) (iterative)**: Translate constraints into non-linear equations and solve them using methods like Newton-Raphson or Levenberg-Marquardt.[^2]
   - *History*: Numerical constraint solving dates back to Ivan Sutherland's pioneering **Sketchpad** in 1963, which used relaxation techniques to satisfy geometric constraints. As digital computing advanced, numerical solvers were standardized around multi-variable optimization and root-finding mathematical libraries.
   - *Product integration*: Used by **SolveSpace**, **FreeCAD** (Sketcher workbench via the Planegcs solver), and modern web-based CAD modeling platforms (e.g., Zoo Design Studio using the `ezpz` Rust solver). Snapping and inference systems in non-parametric tools (like **SketchUp**) also employ basic numerical relaxation to align geometries.

2. **[Constructive solvers](file:///home/red/ws/webcad/docs/glossary.md#constructive-solver) (graph-based)**: Analyze the constraint network first to find a sequence of step-by-step, analytical geometric operations (such as calculating the intersection points of lines and circles).[^3] They are extremely fast and predictable, but writing them is highly complex, and they cannot solve all systems of equations.
   - *History*: Developed in the late 1980s and 1990s as a high-performance alternative to numerical solvers, pioneered by researchers like Christoph Hoffmann. The commercial success of constructive solvers led to the founding of D-Cubed in Cambridge, UK, which created the first commercial geometric constraint solver component (D-Cubed DCM).
   - *Product integration*: Relied upon by major commercial CAD applications like **SolidWorks**, **Autodesk Inventor**, **CATIA**, **Siemens NX**, **AutoCAD** (for its parametric constraints), and **Revit** (for aligning walls, levels, and architectural grids). These commercial packages license proprietary engines (Siemens D-Cubed DCM or Spatial CDS) that prioritize constructive graph reduction before falling back to numerical iteration.

3. **[Degrees of freedom (DoF) analysis](file:///home/red/ws/webcad/docs/glossary.md#degrees-of-freedom-dof)**: Used to determine if a sketch is under-constrained (has remaining degrees of freedom), fully-constrained (zero degrees of freedom), or over-constrained (redundant or conflicting constraints).[^4]
   - *History*: Originating in classical mechanics and kinematic linkage analysis, DoF tracking was integrated into CAD engines in the 1990s to improve user interaction. By tracking variables and equations dynamically, CAD systems could guide users in completing sketches.
   - *Product integration*: Standard in all major parametric modeling software, including **SolidWorks**, **Autodesk Inventor**, **FreeCAD**, **SolveSpace**, and **Revit**. This analysis drives the UI feedback loops that dynamically change entity colors (e.g., from blue to green) once a sketch becomes fully constrained.

### 1.1. How degrees of freedom analysis interacts with solvers

DoF analysis is not an alternative to numerical or constructive solving; rather, it is a **complementary analysis phase** that runs before, during, and after the solving process.

*   **Preprocessing (Decomposition)**: In constructive/graph-based solvers (such as D-Cubed DCM), DoF analysis is the first step. The solver represents the sketch as a graph of geometric entities and constraints, analyzing it to identify independent sub-graphs that are fully constrained (DoF = 0 relative to each other). The solver then collapses these solved clusters into rigid bodies, simplifying the global system step-by-step.
*   **Execution (Jacobian Rank)**: In numerical solvers, DoF analysis is computed dynamically via linear algebra. The solver builds a derivative Jacobian matrix ($J$) of the constraint equations. By calculating the rank ($R$) of this matrix, the solver computes the remaining degrees of freedom ($DoF = N - R$, where $N$ is the number of coordinate variables). This rank calculation identifies redundant equations (preventing mathematical singular states) and determines the path of least-squares motion during user dragging.
*   **Postprocessing (UI Feedback)**: After the solver executes, the resulting DoF status of each primitive is passed to the user interface. This drives color coding (e.g., under-constrained lines colored blue, fully-locked lines colored green) and limits cursor dragging behaviors to only allow movements along the remaining unconstrained directions.

---

## 2. Key open-source desktop applications using GCS

### 2.1. SolveSpace
**SolveSpace** is a legendary, lightweight, open-source 2D/3D parametric CAD program. It features an exceptionally fast and robust custom 2D/3D constraint solver.

- **Architecture**: Written in C++. The constraint solver is decoupled from the GUI and exists as a library (`libsolvespace`).
- **Mathematical approach**: It uses a numerical solver based on a modified Newton-Raphson method. It represents constraints as symbolic equations and solves them using double-precision floating-point arithmetic.
- **Key features**:
  - Extremely fast response times for constraint solving.
  - Linkage simulation (can solve and animate 2D/3D mechanisms in real time).
  - Excellent export capabilities (DXF, SVG, PDF, STEP).
  - Clean, minimalist, and retro user interface.
- **Paradigm**: Draws directly on the "Sketch → Dimension → Extrude" workflow. The user creates a sketch, applies geometric constraints, and the solver immediately snaps the drawing into shape.

### 2.2. FreeCAD (Sketcher workbench)
**FreeCAD** is a feature-rich, modular, open-source parametric 3D modeler. Its **Sketcher workbench** is the core tool for creating 2D geometries that serve as the foundation for 3D operations.

- **Architecture**: Built in C++ with Python bindings. The Sketcher workbench integrates the **Planegcs** solver.
- **Mathematical approach**: Planegcs is an iterative numerical solver that supports dog-leg, Levenberg-Marquardt, and conjugate gradient optimization algorithms to minimize constraint error.
- **Key features**:
  - Full [degree of freedom (DoF)](file:///home/red/ws/webcad/docs/glossary.md#degrees-of-freedom-dof) visual feedback (elements change color when fully constrained).
  - Support for complex curves (B-splines) and advanced constraints (e.g., equal length, tangent, symmetric, block/rigid groups).
  - Robust handling of redundant and conflicting constraints (auto-identifies and highlights conflicting dimensions).
- **Paradigm**: Closely mirrors the sketching paradigm of industry-grade desktop CAD suites like SolidWorks. Sketches are drawn on a plane, fully constrained to ensure mathematical predictability, and then referenced by features (pad, pocket, revolve) in the modeling tree.

### 2.3. CAD Sketcher (Blender addon)
**CAD Sketcher** is a relatively new, highly popular open-source addon for Blender that brings CAD-style parametric 2D sketching to the polygon-modeling world.

- **Architecture**: Written in Python. It packages and utilizes the **SolveSpace solver engine** (`libsolvespace` or its Python binding `pygcs`) as the core mathematical backend.
- **Key features**:
  - Bridges the gap between CAD-precision drafting and Blender's creative modeling workflows.
  - Real-time constraint solving within the Blender 3D viewport.
  - Fully non-destructive parametric editing.
- **Paradigm**: Illustrates the adaptability of decoupled constraint solver libraries. It shows that GCS engines like SolveSpace's can be transplanted into completely foreign runtime environments (like Blender's mesh system) while maintaining their core interactive behavior.

---

## 3. Comparison of core open-source GCS tools

### 3.1. Tool summary table

| Program / library / solver | License | Language | Solver type | Best for | Extensibility / portability |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SolveSpace** (`libsolvespace`) | GPL-3.0 | C++ | Numerical (Newton-Raphson) | Lightweight CAD, 2D linkages, precise vector export | Good; solver is decoupled and has Python/WASM ports. |
| **FreeCAD** (`Planegcs`) | LGPL-2.1+ | C++ | Numerical (Multi-algorithm) | High-fidelity mechanical CAD sketches | Highly integrated in FreeCAD, but recently ported to standalone WebAssembly. |
| **CAD Sketcher** | GPL-3.0 | Python / C++ | Numerical (via SolveSpace) | Parametric sketching inside Blender | Highly specific to Blender, but showcases solver integration. |
| **ezpz** (by KittyCAD) | Apache-2.0 / MIT | Rust | Numerical (Optimized optimization solvers) | High-performance WASM and systems integration | Excellent; native Rust compiles cleanly to WASM with auto-generated bindings. |

### 3.2. Solver feature table
This table provides a canonical list of geometric constraint solver capabilities, mapping support across the underlying mathematical engines.

| Category | Feature (Shortcode) | Description | SolveSpace (`libsolvespace`) | FreeCAD (`Planegcs`) | ezpz |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Solver constraint** | Coincidence<br>`feat-solver-constraint-coincident` | Forces two points to occupy the exact same coordinate, or a point to lie on a line, circle, or curve. | ✓ | ✓ | ✓ |
| **Solver constraint** | Parallelism<br>`feat-solver-constraint-parallel` | Constrains two lines or directional entities to share the same vector slope. | ✓ | ✓ | ✓ |
| **Solver constraint** | Perpendicularity<br>`feat-solver-constraint-perpendicular` | Forces two lines to intersect at a 90-degree angle. | ✓ | ✓ | ✓ |
| **Solver constraint** | Tangency<br>`feat-solver-constraint-tangent` | Constrains a line to be tangent to a circle or curve, or two curves to share a tangent vector at a point. | ✓ | ✓ | ✓ |
| **Solver constraint** | Concentricity<br>`feat-solver-constraint-concentric` | Forces two or more circular/arc curves to share the same center point. | ✓ | ✓ | ✓ |
| **Solver constraint** | Distance<br>`feat-solver-constraint-distance` | Fixes the exact linear distance between two points, or the perpendicular distance from a point to a line. | ✓ | ✓ | ✓ |
| **Solver constraint** | Angle<br>`feat-solver-constraint-angle` | Constrains the angular delta between two lines to a specific value. | ✓ | ✓ | ✓ |
| **Solver constraint** | Symmetry<br>`feat-solver-constraint-symmetric` | Forces two geometric entities to be mirror images of each other across a specified line of symmetry. | ✓ | ✓ | ✓ |
| **Solver constraint** | Equality<br>`feat-solver-constraint-equal` | Requires two entities (e.g., two circles' radii, or two lines' lengths) to have equal values. | ✓ | ✓ | ✓ |
| **Solver geometry** | Point Primitive<br>`feat-solver-geom-point` | Basic 2D coordinate pair `(x, y)` serving as the foundation for other primitives. | ✓ | ✓ | ✓ |
| **Solver geometry** | Line Segment<br>`feat-solver-geom-line` | Defined by a start point and end point, representing a straight line boundary. | ✓ | ✓ | ✓ |
| **Solver geometry** | Circle Primitive<br>`feat-solver-geom-circle` | Defined by a center point and a radius parameter. | ✓ | ✓ | ✓ |
| **Solver geometry** | Arc Primitive<br>`feat-solver-geom-arc` | A portion of a circle defined by a center, radius, start angle, and end angle. | ✓ | ✓ | ✓ |
| **Solver geometry** | Ellipse Primitive<br>`feat-solver-geom-ellipse` | Defined by a center point, major axis radius, minor axis radius, and angle. | ✓ | ✓ | ✗ |
| **Solver state** | Degree of Freedom Tracking<br>`feat-solver-state-dof` | The ability of the solver to dynamically calculate and report the remaining degrees of freedom in the sketch. | ✓ | ✓ | ✓ |
| **Solver state** | Conflict Detection<br>`feat-solver-state-conflict` | The capability to isolate and report conflicting equations to prevent solver divergence. | ✓ | ✓ | ✓ |

### 3.3. Drawing tool feature table
This table compares the end-user drawing applications and design suites (excluding the raw solver engines) to highlight how various CAD tools handle parametric 2D and 3D modeling.

| Feature (Shortcode) | Description | SolidWorks | FreeCAD | AutoCAD | Revit | SolveSpace |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Parametric 2D sketching**<br>`feat-tool-sketching-parametric` | Creation of 2D profiles defined by geometric constraints and dimensions. | ✓ | ✓ | ✗ (Basic) | ✓ | ✓ |
| **3D feature history tree**<br>`feat-tool-3d-history` | Sequential order of operations (extrusions, cuts, sweeps) that can be re-evaluated. | ✓ | ✓ | ✗ | ✓ | ✓ (Basic groups) |
| **Technical drawing sheets**<br>`feat-tool-drafting-sheets` | Generation of 2D sheets/blueprints with dimensions, labels, and borders. | ✓ | ✓ | ✓ | ✓ | ✓ (Export only) |
| **Assembly modeling**<br>`feat-tool-assembly` | Combining multiple parts into assemblies with joint/mate constraints. | ✓ | ✓ | ✗ | ✓ | ✓ |
| **BIM (Building Information Modeling)**<br>`feat-tool-bim` | Architecture-specific modeling of walls, doors, windows, and schedules. | ✗ | ✓ (Arch) | ✗ | ✓ | ✗ |
| **2D vector drafting**<br>`feat-tool-2d-drafting` | Non-parametric drafting focusing on layers, line weights, and raw geometry. | ✗ | ✗ | ✓ | ✗ | ✗ |
| **Collaborative / cloud modeling**<br>`feat-tool-collaboration` | Simultaneous multi-user editing, version control, and storage in a web browser. | ✗ | ✗ | ✗ (Basic viewer) | ✓ (BIM 360) | ✗ |

### 3.4. Formats
This section discusses the standard and proprietary file formats used by GCS tools for importing, exporting, and persisting sketches and constraints.

#### Proprietary/tool-specific formats
- **SolveSpace (`.slvs`)**: A custom text-based format that serializes the parametric history, geometric primitives, and constraints in a structured sequential block. Since it is plain text, it is highly readable and git-friendly.
- **FreeCAD (`.FCStd`)**: A compressed ZIP file containing XML documents (defining the geometry and constraint tree), alongside binary representations of the 3D shapes.
- **JSketcher (`.json` / custom)**: Usually serializes the sketch as a JSON object containing lists of primitives (id, type, parameters) and constraints (type, references, values), which is highly convenient for web applications.

#### Standardized CAD exchange formats
- **DXF (Drawing Exchange Format)**: A widely adopted 2D vector CAD format created by Autodesk. It stores lines, circles, and arcs, but it **does not** preserve geometric constraints or parameters. Importing a DXF yields static vector elements.
- **SVG (Scalable Vector Graphics)**: A standard XML-based web vector format. Like DXF, SVG does not support constraints natively. It is used primarily for rendering output, not for editing parametric relationships.
- **STEP (Standard for the Exchange of Product Model Data)**: A mature ISO-standard 3D CAD data exchange format. While it supports rich 3D B-Rep geometry and metadata, the raw STEP standard does not preserve the original 2D constraint equations from the sketcher workbench; it stores the finished 3D solids.
- **IGES (Initial Graphics Exchange Specification)**: An older, widely-supported CAD exchange format. Like STEP, it is used for exchange of finalized 3D curves and surfaces, not editable parametric sketches.

*Summary*: There is no universal, standardized open-source format for exchanging **2D geometric constraints**. Each tool has its own proprietary format to map equations, parameters, and constraints. When building WebCAD, a structured JSON format representing primitives and constraints will be the most suitable for serialization and web state persistence.

### Note on non-constraint open-source 2D CAD
It is important to contrast the GCS tools with other highly popular open-source 2D CAD programs:
- **LibreCAD** and **QCAD**: These tools are built for traditional 2D technical drafting (akin to classic AutoCAD). They excel at drawing static lines, layers, and blocks, but they **do not** feature a geometric constraint solver. You cannot define a relationship like "Line A must remain tangent to Circle B as I drag it"; you must calculate and draw the tangency manually.

---

## 4. Comparison with established proprietary solvers

While open-source constraint solvers have matured significantly, professional desktop CAD packages rely on highly optimized proprietary solver SDKs. The two most dominant commercial engines are:

1. **D-Cubed 2D DCM (Dimensional Constraint Manager)**: Developed by Siemens. It is the industry-standard geometric solver, licensing its technology to Autodesk (for Inventor and AutoCAD), Dassault Systèmes (for SolidWorks), PTC (for Creo), and Siemens itself (for NX and Solid Edge).
2. **Spatial CDS (Constraint Design Solver)**: Developed by Spatial (a subsidiary of Dassault Systèmes). It is used primarily in CATIA and other applications within the Dassault ecosystem.

### 4.1. Key differences and commercial advantages

The proprietary solvers have several distinct technical advantages over current open-source implementations:

- **Algebraic and graph-reduction preprocessing**: Commercial solvers do not just run numerical methods (like Newton-Raphson) on the entire equation set. Instead, they first analyze the constraint graph to decompose the system into smaller, independent sub-problems that can be solved analytically (e.g., using constructive geometry steps). Numerical solvers are only used as a fallback for coupled or cyclic constraint loops. This results in far greater solving speed, scalability (thousands of constraints), and stability.
- **Advanced degree of freedom (DoF) analysis**: They can identify exactly which parts of a sketch are under-constrained, and in which directions they can move, providing detailed interactive feedback to the user (e.g., displaying drag handles that restrict movement to the remaining degrees of freedom).
- **Auto-dimensioning and constraint recommendation**: They can automatically generate a set of dimensions and constraints to fully constrain a sketch without creating conflicts.
- **Predictable topology/drag behaviors**: When a user drags a point, commercial solvers use sophisticated path-following algorithms (homotopy continuation) to find the most "natural" or expected configuration, avoiding erratic snapping or inversion of geometry (such as circles flipping inside-out).

### 4.2. High-level comparison table

| Capability | Open-Source Solvers (Planegcs, SolveSpace, ezpz) | Proprietary Solvers (D-Cubed 2D DCM, Spatial CDS) |
| :--- | :--- | :--- |
| **Solving Approach** | Primarily numerical optimization (Newton-Raphson, Levenberg-Marquardt). | Hybrid (Decomposition analysis + constructive solving + numerical fallback). |
| **Scalability** | Typically starts to degrade or lag when exceeding 100-200 coupled constraints. | Scales smoothly to thousands of geometric entities and constraints. |
| **Snapping & Dragging** | Uses closest numerical convergence; can snap to unexpected geometric configurations. | Employs homotopy path continuation to maintain predictable dragging states. |
| **Redundancy Isolation** | Basic conflict detection (usually reports the final equation that broke the system). | Pinpoints exact minimal over-constrained loops and highlights conflicting entities. |
| **Commercial Licensing** | Open-source (LGPL, GPL, Apache-2.0). Free to use. | High-cost commercial licensing fees per seat/developer. |

---

## 5. Key takeaways for WebCAD development

To implement a modern web-based sketching tool, we can extract several design lessons from these established desktop implementations:

1. **Decouple the math from the rendering**: Like SolveSpace (`libsolvespace`) and FreeCAD (`Planegcs`), our web-based architecture should separate the constraint solver logic (which operates on raw point coordinates, lengths, and angles) from the canvas viewport (which handles mouse events, pan/zoom, and pixel rendering).
2. **Provide real-time solver feedback**: Users expect immediate feedback. When they drag a point, the solver must run on every mouse movement (typically targeting <16ms frame times) to dynamically update the sketch.
3. **Visual [degree of freedom (DoF)](file:///home/red/ws/webcad/docs/glossary.md#degrees-of-freedom-dof) status**: Following the FreeCAD Sketcher pattern, we should visually indicate to the user whether the sketch is under-constrained (often colored white/blue) or fully-constrained (often colored green). This is critical for creating predictable, robust designs.
4. **Graceful handling of over-constraining**: If a user adds a constraint that conflicts with an existing one, the solver must not crash. It should detect the contradiction, prevent the new constraint from breaking the system, and highlight the offending relations so the user can resolve them.

---

[^1]: For instance, a distance constraint between two points $(x_1, y_1)$ and $(x_2, y_2)$ is mathematically formulated as the quadratic equation $(x_2 - x_1)^2 + (y_2 - y_1)^2 - d^2 = 0$. Solving these systems requires finding the roots of multiple simultaneous equations. For a comprehensive overview of algebraic formulations, see the [Geometric constraint solving article on Wikipedia](https://en.wikipedia.org/wiki/Geometric_constraint_solving).
[^2]: Iterative numerical optimization algorithms converge rapidly when the initial guess is close to the solution, but they can get stuck in local minima or fail to converge for under-constrained sketches. More robust solvers like the [Levenberg-Marquardt algorithm](https://en.wikipedia.org/wiki/Levenberg%E2%80%93Marquardt_algorithm) interpolate between the Gauss-Newton algorithm and gradient descent to improve convergence stability.
[^3]: Graph-based constructive solvers partition the constraint graph into small, solvable clusters (e.g., triangles) to solve the system analytically. This decomposition avoids solving a giant, sparse system of equations all at once, which is why commercial solvers use it for performance. See [Hoffmann et al.'s research on geometric constraint decomposition](https://en.wikipedia.org/wiki/Geometric_constraint_solving#Graph-based_solvers) for details on graph reduction.
[^4]: Real-time degree of freedom (DoF) tracking determines if a sketch is mathematically locked. In SolveSpace, the solver calculates the rank of the Jacobian matrix of constraints to determine the exact number of remaining degrees of freedom, which is used to color-code under-constrained elements. See the [SolveSpace technical details](https://solvespace.com/tech.html) for their specific implementation of DoF calculations.

