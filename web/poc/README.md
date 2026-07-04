# WebCAD 2D Sketcher WASM POC

This directory contains the Proof of Concept (POC) for a client-side WebAssembly-based 2D Geometric Constraint Solver (GCS) viewport.

## Bazel Build Architecture

The project builds and executes entirely within the Bazel sandbox using official Rust and Go rules.

### 1. Rust WebAssembly Crate (`poc/solver-wasm`)
- The Rust solver utilizes the `@ezpz` GCS library wrapper.
- To compile Rust to WebAssembly (Wasm) under Bazel:
  - We use the official `rules_rust_wasm_bindgen` rules.
  - The solver is compiled as a `rust_shared_library` (with `cdylib` crate type) targeting `wasm32-unknown-unknown`.
  - The compiled shared library is passed as an input to the `rust_wasm_bindgen` build rule:
    ```bazel
    rust_wasm_bindgen(
        name = "solver_wasm_bindgen",
        target = "web",
        wasm_file = ":solver_wasm",
    )
    ```
  - This outputs the optimized `.wasm` binary along with the generated JavaScript ES Module binding files inside the Bazel sandbox.

### 2. Go Web Server (`poc/BUILD.bazel`)
- A Go-based static assets server ([main.go](file:///home/red/ws/webcad/poc/main.go)) is configured using `rules_go`.
- The Go binary takes all static UI files and the compiled WASM bindgen files as a `data` dependency:
  ```bazel
  go_binary(
      name = "poc",
      data = [
          "ui/index.html",
          "//poc/solver-wasm:solver_wasm_bindgen",
      ] + glob(["dist/**/*.js"]),
      embed = [":poc_lib"],
  )
  ```
- At runtime, the server utilizes the official Bazel Go runfiles library (`"github.com/bazelbuild/rules_go/go/runfiles"`) to locate and serve the assets directly from the sandboxed runfiles directories, ensuring correct MIME types (specifically `application/wasm`) are served.

---

## Bazel Commands

### Build Wasm Targets
Compile the Rust solver and generate its JS bindings:
```bash
bazel build --platforms=@rules_rust//rust/platform:wasm32 //poc/solver-wasm:solver_wasm_bindgen
```

### Run Host Unit Tests
Run the coincident coordinate GCS assertions on the host platform:
```bash
bazel test //poc/solver-wasm:solver_wasm_test
```

### Launch the Viewport Web Server
Build and start the Go static asset server:
```bash
bazel run //poc:poc
```
Once started, navigate to [http://localhost:8080](http://localhost:8080) to interact with the sketcher.
