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

## Patch Details

A patch file [`ezpz.patch`](file:///home/red/ws/webcad-solver/third_party/ezpz/ezpz.patch) is applied at fetch time to resolve compile and path resolution issues:

### 1. CLI Compilation Fixes (`ezpz-cli/src/main.rs`)
*   **Non-exhaustive Struct Destructuring**: The `FailureOutcome` struct is marked as `#[non_exhaustive]` upstream. Destructuring it in `main.rs` requires using `..` to ignore other potential fields.
*   **PathBuf Comparison**: Fixed a type error where a `PathBuf` was compared directly to a string literal `&str` `"-"`. This was changed to compare via `.to_str()`.

### 2. Sandboxed Path Resolution (`ezpz/src/tests.rs`)
*   Upstream unit tests resolve problem files using a hardcoded relative path `../test_cases/`.
*   Under Bazel test execution, the tests run inside a sandboxed environment where files are located in a runfiles tree.
*   The patch introduces a helper `get_test_case_path` that dynamically resolves path locations using `CARGO_MANIFEST_DIR` (stripping the `external/` prefix when running under Bazel Bzlmod) and `TEST_SRCDIR` (runfiles directory), ensuring tests pass successfully under both Cargo and Bazel.

---

## Upstream Contributions

To eliminate the need for the local patch file, the following changes can be submitted upstream to the `KittyCAD/ezpz` repository:

1.  **CLI Fixes**: Submit a Pull Request containing the compiler fixes in `ezpz-cli/src/main.rs`. These are standard Rust bug fixes that will allow the CLI crate to compile out of the box.
2.  **Test path helper**: Submit a PR to update `tests.rs` to use `CARGO_MANIFEST_DIR` for test case path lookup. Resolving test files relative to the manifest directory (rather than using raw relative paths) is a standard Cargo best practice and makes the crate friendly to other build systems.
