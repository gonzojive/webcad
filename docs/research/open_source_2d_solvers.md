# Open-Source 2D Drawing Programs with Geometric Constraint Solvers

This report outlines the landscape of existing open-source 2D drawing and sketching programs that employ geometric constraint solvers (GCS). It analyzes their architectures, capabilities, and the design paradigms they share with professional industry-standard parametric CAD software (such as SolidWorks or FreeCAD), without focusing on specific commercial web-based offerings.

---

## 1. Understanding Geometric Constraint Solvers (GCS)

In parametric design, a 2D sketch is not just a collection of static vector elements. Instead, it is a dynamic system of geometric primitives (points, lines, arcs, circles, ellipses) governed by a set of mathematical relations called **constraints** (coincidence, parallelism, perpendicularity, tangency, distance, angle, equality, etc.).

A **Geometric Constraint Solver** is the mathematical engine that takes the current state of these primitives and constraints, translates them into a system of equations (often non-linear), and solves them to find the new positions of all entities. 

Solvers generally fall into three categories:
1. **Numerical Solvers (Iterative)**: Translate constraints into non-linear equations and solve them using methods like Newton-Raphson or Levenberg-Marquardt. They are highly flexible and handle complex constraints well, but require good initial guesses to converge to the desired solution.
2. **Constructive/Graph-Based Solvers**: Analyze the constraint network first to find a sequence of ruler-and-compass constructions. They are extremely fast and predictable, but writing them is highly complex, and they cannot solve all systems of equations.
3. **Degrees of Freedom (DoF) Analysis**: Used to determine if a sketch is under-constrained (has remaining degrees of freedom), fully-constrained (zero degrees of freedom), or over-constrained (redundant or conflicting constraints).

---

## 2. Key Open-Source Desktop Applications using GCS

### 2.1. SolveSpace
**SolveSpace** is a legendary, lightweight, open-source 2D/3D parametric CAD program. It features an exceptionally fast and robust custom 2D/3D constraint solver.

- **Architecture**: Written in C++. The constraint solver is decoupled from the GUI and exists as a library (`libsolvespace`).
- **Mathematical Approach**: It uses a numerical solver based on a modified Newton-Raphson method. It represents constraints as symbolic equations and solves them using double-precision floating-point arithmetic.
- **Key Features**:
  - Extremely fast response times for constraint solving.
  - Linkage simulation (can solve and animate 2D/3D mechanisms in real time).
  - Excellent export capabilities (DXF, SVG, PDF, STEP).
  - Clean, minimalist, and retro user interface.
- **Paradigm**: Draws directly on the "Sketch → Dimension → Extrude" workflow. The user creates a sketch, applies geometric constraints, and the solver immediately snaps the drawing into shape.

### 2.2. FreeCAD (Sketcher Workbench)
**FreeCAD** is a feature-rich, modular, open-source parametric 3D modeler. Its **Sketcher Workbench** is the core tool for creating 2D geometries that serve as the foundation for 3D operations.

- **Architecture**: Built in C++ with Python bindings. The Sketcher Workbench integrates the **Planegcs** solver.
- **Mathematical Approach**: Planegcs is an iterative numerical solver that supports dog-leg, Levenberg-Marquardt, and conjugate gradient optimization algorithms to minimize constraint error.
- **Key Features**:
  - Full Degree of Freedom (DoF) visual feedback (elements change color when fully constrained).
  - Support for complex curves (B-splines) and advanced constraints (e.g., equal length, tangent, symmetric, block/rigid groups).
  - Robust handling of redundant and conflicting constraints (auto-identifies and highlights conflicting dimensions).
- **Paradigm**: Closely mirrors the sketching paradigm of industry-grade desktop CAD suites like SolidWorks. Sketches are drawn on a plane, fully constrained to ensure mathematical predictability, and then referenced by features (pad, pocket, revolve) in the modeling tree.

### 2.3. CAD Sketcher (Blender Addon)
**CAD Sketcher** is a relatively new, highly popular open-source addon for Blender that brings CAD-style parametric 2D sketching to the polygon-modeling world.

- **Architecture**: Written in Python. It packages and utilizes the **SolveSpace solver engine** (`libsolvespace` or its Python binding `pygcs`) as the core mathematical backend.
- **Key Features**:
  - Bridges the gap between CAD-precision drafting and Blender's creative modeling workflows.
  - Real-time constraint solving within the Blender 3D viewport.
  - Fully non-destructive parametric editing.
- **Paradigm**: Illustrates the adaptability of decoupled constraint solver libraries. It shows that GCS engines like SolveSpace's can be transplanted into completely foreign runtime environments (like Blender's mesh system) while maintaining their core interactive behavior.

---

## 3. Comparison of Core Open-Source GCS Tools

| Program / Library / Solver | License | Language | Solver Type | Best For | Extensibility / Portability |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SolveSpace** (`libsolvespace`) | GPL-3.0 | C++ | Numerical (Newton-Raphson) | Lightweight CAD, 2D linkages, precise vector export | Good; solver is decoupled and has Python/WASM ports. |
| **FreeCAD** (`Planegcs`) | LGPL-2.1+ | C++ | Numerical (Multi-algorithm) | High-fidelity mechanical CAD sketches | Highly integrated in FreeCAD, but recently ported to standalone WebAssembly. |
| **CAD Sketcher** | GPL-3.0 | Python / C++ | Numerical (via SolveSpace) | Parametric sketching inside Blender | Highly specific to Blender, but showcases solver integration. |
| **ezpz** (by KittyCAD) | Apache-2.0 / MIT | Rust | Numerical (Optimized optimization solvers) | High-performance WASM and systems integration | Excellent; native Rust compiles cleanly to WASM with auto-generated bindings. |

### Note on Non-Constraint Open-Source 2D CAD
It is important to contrast the above tools with other highly popular open-source 2D CAD programs:
- **LibreCAD** and **QCAD**: These tools are built for traditional 2D technical drafting (akin to classic AutoCAD). They excel at drawing static lines, layers, and blocks, but they **do not** feature a geometric constraint solver. You cannot define a relationship like "Line A must remain tangent to Circle B as I drag it"; you must calculate and draw the tangency manually.

---

## 4. Key Takeaways for WebCAD Development

To implement a modern web-based sketching tool, we can extract several design lessons from these established desktop implementations:

1. **Decouple the Math from the Rendering**: Like SolveSpace (`libsolvespace`) and FreeCAD (`Planegcs`), our web-based architecture should separate the constraint solver logic (which operates on raw point coordinates, lengths, and angles) from the canvas viewport (which handles mouse events, pan/zoom, and pixel rendering).
2. **Provide Real-Time Solver Feedback**: Users expect immediate feedback. When they drag a point, the solver must run on every mouse movement (typically targeting <16ms frame times) to dynamically update the sketch.
3. **Visual Degree of Freedom (DoF) Status**: Following the FreeCAD Sketcher pattern, we should visually indicate to the user whether the sketch is under-constrained (often colored white/blue) or fully-constrained (often colored green). This is critical for creating predictable, robust designs.
4. **Graceful Handling of Over-Constraining**: If a user adds a constraint that conflicts with an existing one, the solver must not crash. It should detect the contradiction, prevent the new constraint from breaking the system, and highlight the offending relations so the user can resolve them.
