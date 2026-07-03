# ezpz Integration

This directory contains the Bazel Bzlmod integration files for the [`ezpz`](https://github.com/KittyCAD/ezpz) geometric constraint solver.

## Overview

Rather than vendoring the entire `ezpz` codebase, we fetch it dynamically from GitHub using a Bzlmod module extension. We then apply local patches and overlay Bazel BUILD targets at fetch time.

## Directory Structure

*   [`BUILD.bazel`](file:///home/red/ws/webcad-solver/third_party/ezpz/BUILD.bazel): Package marker file.
*   [`ezpz.BUILD`](file:///home/red/ws/webcad-solver/third_party/ezpz/ezpz.BUILD): The root Bazel BUILD file overlaid on the fetched `@ezpz` repository.
*   [`ezpz.patch`](file:///home/red/ws/webcad-solver/third_party/ezpz/ezpz.patch): Patches applied to the fetched source code to resolve compilation and testing issues.
*   [`README.md`](file:///home/red/ws/webcad-solver/third_party/ezpz/README.md): This documentation file.

---

## Build Configuration & Crate Features

Under Cargo, the CLI crate `ezpz-cli` depends on the `ezpz` library crate with the `unstable-exhaustive` feature enabled. 
Bazel target dependencies do not automatically propagate features downstream. To align compilation features with Cargo:
*   We explicitly set `crate_features = ["unstable-exhaustive"]` on the `ezpz` target inside the patched `ezpz/BUILD.bazel`.
*   This configures `FailureOutcome` as exhaustive, resolving the CLI's struct destructuring compiler errors without requiring any source-code patches.

---

## Patch Details

A patch file [`ezpz.patch`](file:///home/red/ws/webcad-solver/third_party/ezpz/ezpz.patch) is applied at fetch time to resolve remaining compilation and path resolution issues:

### 1. CLI Compilation Fixes (`ezpz-cli/src/main.rs`)
*   **PathBuf Comparison**: Fixed a genuine compiler bug where a `PathBuf` was compared directly to a string literal `&str` `"-"`. This was changed to compare via `.to_str()`.

### 2. Sandboxed Path Resolution (`ezpz/src/tests.rs`)
*   Upstream unit tests resolve problem files using a hardcoded relative path `../test_cases/`.
*   Under Bazel test execution, the tests run inside a sandboxed environment where files are located in a runfiles tree.
*   The patch introduces a helper `get_test_case_path` that dynamically resolves path locations using `CARGO_MANIFEST_DIR` (stripping the `external/` prefix when running under Bazel Bzlmod) and `TEST_SRCDIR` (runfiles directory), ensuring tests pass successfully under both Cargo and Bazel.

---

## Upstream Contributions

To eliminate the need for the local patch file, the following changes can be submitted upstream to the `KittyCAD/ezpz` repository:

1.  **CLI Fixes**: Submit a Pull Request containing the compiler fix in `ezpz-cli/src/main.rs` (changing `&cli.filepath != "-"` to `cli.filepath.to_str() != Some("-")` or `cli.filepath.as_path() != std::path::Path::new("-")`). This is a genuine bug that prevents the CLI crate from compiling under standard workspace builds (`cargo build -p ezpz-cli`).
2.  **Test path helper**: Submit a PR to update `tests.rs` to use `CARGO_MANIFEST_DIR` for test case path lookup. Resolving test files relative to the manifest directory (rather than using raw relative paths) is a standard Cargo best practice and makes the crate friendly to other build systems.
