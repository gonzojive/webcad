# WebCAD Frontend Architecture Review & Design Proposal

**Date:** July 4, 2026
**Author:** Gemini

This document assesses the current state of the WebCAD frontend and proposes a scalable architecture to support a full-featured 2D visualizer, integrating insights from the UI frameworks research and the feature pipeline (derived from GitHub issues).

## 1. Current State Assessment

The current frontend is functional for a proof-of-concept but suffers from severe architectural coupling that will impede scalability. 

### Major Issues Identified
1. **The "God Class" Anti-Pattern**: 
   - `viewport.ts` (1,600+ lines) is overloaded. It mixes Konva rendering logic, coordinate transformations, complex geometric math (e.g., point projections, bounding boxes), and raw event listening.
   - `main.ts` (1,000+ lines) acts as a monolithic controller. It manages tool state, DOM manipulation (toolbar, inputs), and business logic for constraints.
2. **Vanilla DOM Manipulation**: The UI overlay (toolbars, inline inputs, sidebars) is managed through imperative vanilla TypeScript DOM manipulation. Creating dynamic interfaces like property panels, constraint dialogs, or undo/redo histories will quickly turn into unmaintainable spaghetti code without a declarative framework.
3. **Switch-Statement Tool Logic**: Drawing interactions (Line, Circle, Dimension) are managed via massive `if/else` or `switch` statements inside mouse event handlers, making it very difficult to add new tools.
4. **Scattered State**: State is duplicated between the `CanvasViewport` and `main.ts`.
5. **Coupled Rendering & Hit Detection**: The core drawing tools assume they operate directly on a 2D HTML Canvas, calculating distances in screen-space. This blocks any future path to projecting the sketch onto a 3D plane in WebGL.

---

## 2. Proposed Architecture: The "Hybrid Canvas-DOM Component" Model

Aligning with the `docs/research/web_2d_drawing_frameworks.md` (Option A), we should adopt a Hybrid Canvas-DOM stack but enforce strict boundaries using modern software design patterns.

### A. The Tech Stack Upgrade
*   **Interactive Viewport**: Remain on **Konva.js** (HTML5 Canvas) for now, but abstract the implementation (see section 2D below) to allow swapping for **Three.js (WebGL)** when 3D modeling is introduced.
*   **DOM Overlay & UI Framework**: **Angular (using Signals)**. Angular's dependency injection is ideal for complex applications like CAD. The new Angular Signals provide fine-grained reactivity, allowing us to update DOM overlays (like dimension inputs or constraint badges) rapidly in sync with canvas dragging without triggering heavy component tree re-renders.
*   **State Management**: Use Angular Services + Signals as a centralized store for the `Document` and `ToolManager`.

### B. Structural Decoupling

We need to break down the monolithic files into domain-specific modules.

#### 1. Data Model Ontology & Unit System (`web/poc/model/`)
The model must be strictly defined and decoupled from both the UI and the GCS solver.
*   **Document**: The root container. It holds the `SketchModel` and meta-data, including the **Unit System** (e.g., default display units).
*   **HistoryManager**: Manages a stack of discrete step objects (actions or diffs) that construct the current `Document`. This provides native **Undo/Redo** capabilities.
*   **SketchModel**: Contains the geometric dictionary. All values in the internal model MUST be stored in a **canonical internal unit** (e.g., always millimeters or always meters), ensuring mathematical consistency.
    *   **Entities**: `Point`, `Line`, `Circle`, `Rectangle` (base primitives).
    *   **Constraints**: `DistanceConstraint`, `CoincidentConstraint`, `ParallelConstraint`. These reference Entities by ID.
*   **Unit Parser & Formatter**: A standalone utility that parses user strings (e.g., `"4mm"`, `"2in"`, `"1ft + 3in"`) and converts them into the canonical internal float value. Conversely, it formats internal values back into strings based on the Document's display unit preferences.
*   **GCS Bridge**: The frontend `SketchModel` is distinct from the classes sent to the backend GCS. The GCS is a unitless, pure mathematical engine. The Bridge translates the frontend `SketchModel` canonical values into raw variables (x1, y1, x2, y2) and constraints. Because the model already stores everything in a canonical internal unit, the GCS simply balances the numbers and returns them; the Bridge updates the model, and the Unit Formatter handles displaying them correctly to the user.

#### 2. Abstracting the Rendering & Interaction Layer (2D vs 3D)
To future-proof the application for editing sketches on 3D planes (solid modeling), the core tool logic cannot care if it is rendering on a 2D Canvas or a 3D WebGL context.
*   **Coordinate System Abstraction**: The core engine operates purely on `(x, y)` **sketch plane coordinates**. 
*   **`IInteractionProvider`**: Handles hover detection and clicking.
    *   *In 2D (Current)*: Implemented via Canvas math (screen pixels translated to local 2D space, hit-testing via 2D bounding boxes and point-line distances).
    *   *In 3D (Future)*: Implemented via WebGL Raycasting (firing a ray from the camera through the screen pixel onto the 3D sketch plane to calculate the 2D intersection point, resolving hits against 3D bounding volumes).
*   **`IRenderer`**: Handles visual output. 
    *   The `LineTool` says: `IRenderer.drawLine(p1, p2, activeStyle)`.
    *   The Konva implementation draws a 2D line. The Three.js implementation draws a WebGL cylinder or LineSegment on the 3D plane.

#### 3. The Tool System (Strategy Pattern)
Replace the massive `if/else` blocks in event handlers with a scalable tool system.
*   *Concept*: Create a `Tool` interface with methods: `onMouseDown`, `onMouseMove`, `onMouseUp`, `onCancel`.
*   *Implementation*: `LineTool`, `RectangleTool`, `DimensionTool`, and `SelectTool` each get their own isolated class in `src/tools/`. They consume plane coordinates from the `IInteractionProvider` and dispatch actions to the `HistoryManager`.

#### 4. The Math & Geometry Library (`web/poc/geometry/`)
*   *Concept*: Extract all mathematical operations (distance, projection, intersection, vector normalization) from `viewport.ts`.
*   *Implementation*: Move to pure, unit-testable functions, independent of rendering.

#### 5. The Angular DOM Overlay (UI)
*   *Concept*: The toolbar, sidebar, and inline text inputs become Angular Components.
*   *Implementation*: A `DimensionInputComponent` injects the `SelectionService`. When a dimension is double-clicked, the signal fires, and the component renders an absolute-positioned `<input>` over the canvas at the synchronized screen coordinates provided by the `IRenderer`.

---

## 3. Migration Strategy (Incremental Refactor)

We cannot rewrite the entire application at once. We should adopt the strangler fig pattern:

1.  **Phase 1: Abstract the Model, Units, & Geometry**
    *   Create `web/poc/model/` to formalize the Document/Entity/Constraint ontology.
    *   Create `web/poc/units/` for the robust string-to-float unit parsing system (e.g. converting "4mm" to internal canonical units).
    *   Create `web/poc/geometry/` and move math functions out of `viewport.ts`.
2.  **Phase 2: Introduce Angular & State (Signals)**
    *   Mount an Angular app to wrap the existing Canvas.
    *   Replace the vanilla DOM toolbar and sidebar with Angular Components driven by Signals.
    *   Implement the `HistoryManager` (Undo/Redo) using this new state system.
3.  **Phase 3: The Tool System & Renderer Interface**
    *   Implement the `IRenderer` and `IInteractionProvider` interfaces.
    *   Refactor the hardcoded Line/Point/Circle logic out of `main.ts` into individual `Tool` classes that operate purely on the sketch plane abstraction.
