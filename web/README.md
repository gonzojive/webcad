# WebCAD Frontend Development Guide

This directory contains the frontend code for WebCAD. The build system is powered by Bazel using `rules_js` and `rules_ts` with npm workspaces for package resolution.

## Project Structure
*   `web/poc/gcsapi/`: The GCSapi library package (`@webcad/gcsapi`).
*   `web/poc/ui/`: The main UI application (`@webcad/ui`).
*   `package.json`: Root npm workspace configuration.
*   `pnpm-workspace.yaml`: Defines the workspace packages.

## Prerequisites
We use Bazel-managed Node.js and pnpm, so you do not need to install them globally. However, for IDE autocompletion to work, you should run once:
```bash
# Using Bazel's Node to run pnpm install
$(bazel info output_base)/external/rules_nodejs++node+nodejs_linux_amd64/bin/nodejs/bin/node \
$(bazel info output_base)/external/aspect_rules_js++pnpm+pnpm/package/bin/pnpm.cjs install
```
This links the local packages in `node_modules/` on your host disk.

## Standard Development Commands

### Building
Build all frontend and backend targets:
```bash
bazel build //web/poc/...
```

### Testing
Run unit tests (e.g., UI state tests):
```bash
bazel test //web/poc/...
```

### Live Reload Development Loop (ibazel)
To run the Go web server and auto-rebuild frontend changes in the background without restarting the server:
```bash
env PATH=$(bazel info output_base)/external/rules_nodejs++node+nodejs_linux_amd64/bin/nodejs/bin:$PATH \
./node_modules/.bin/ibazel run //web/poc:poc
```
Open `http://localhost:8080` in your browser. Any changes to `.ts` files under `web/poc` will be automatically compiled and updated in the server's runfiles.

## TypeScript Compilation and Target Granularity

### What is `ts_project`?
The `ts_project` rule (from `aspect_rules_ts`) is a Bazel wrapper around the standard TypeScript compiler (`tsc`). It compiles a set of `.ts` source files into `.js` outputs and generates `.d.ts` type declarations.

### Granularity: Why One Target Per Package?
Instead of compiling the entire frontend as a single monolithic block, we split it into granular targets (typically **one `ts_project` per directory/package** that contains a `package.json`):
*   **Incremental Compilation**: If you modify a file in `web/poc/ui`, Bazel only recompiles the `ui` target. The `gcsapi` target remains cached, saving build time.
*   **Encapsulation**: Sandboxing ensures that a package can only import files that are explicitly declared in its `deps`. This prevents accidental circular dependencies and spaghetti imports.
*   **Alignment with npm**: Each `ts_project` corresponds to a local npm package, making the Bazel dependency graph match the npm workspace graph.

---

## Syncing BUILD Files (Gazelle)

We use the **Aspect Gazelle plugin** to automatically generate and maintain `BUILD.bazel` files for Go and TypeScript targets. 

### How Gazelle Automation Works
When you run `./devtools/gaz`, Gazelle scans the source tree and performs the following mapping:

1.  **Target Generation**: For each directory containing TS files and a `package.json`, Gazelle defines:
    *   A `ts_project` named `{dirname}_lib` to compile the TypeScript files.
    *   An `npm_package` named `{dirname}` to package the outputs for workspace consumption.
    *   An `npm_link_all_packages` call to link local dependencies.
2.  **Source Discovery**: Gazelle automatically adds all `.ts` files in the directory to the `srcs` attribute of the `ts_project`. You don't need to list files manually.
3.  **Dependency Resolution**: Gazelle parses `import` statements in your TS files:
    *   If `ui/main.ts` imports `@webcad/gcsapi`, Gazelle detects this, resolves it to the local workspace package, and automatically adds `:node_modules/@webcad/gcsapi` to the `deps` of `ui_lib`.
    *   If you import a third-party package (e.g. `import assert from 'node:assert'`), Gazelle detects that it needs node types and adds `//:node_modules/@types/node` to `deps`.

If you add new source files, rename files, or add/remove dependencies in `package.json`, simply run:
```bash
./devtools/gaz
```
This keeps your Bazel build files in sync with your source code and npm configurations automatically.

## ES Modules (ESM) Configuration

We use modern ES Modules (`import`/`export` syntax) in our TypeScript/JavaScript code. 

To ensure Node.js executes all compiled files as ES Modules by default (even when running tests in the Bazel sandbox), we configure Node.js globally using the following setting in our root `.bazelrc`:

```text
test --test_env=NODE_OPTIONS=--experimental-default-type=module
```

This instructs the Node.js runtime to default to ES Modules for all executed files in this workspace. Consequently:
*   You **do not need** to create marker `package.json` files (containing `{"type": "module"}`) in shared TypeScript library directories.
*   You **do not need** to pass special ESM flags to individual `js_test` targets in your `BUILD` files.

---

## Adding Comments in `package.json`
Since JSON does not support comments, we use the `"//"` key convention to document the purpose of dependencies or metadata fields in `package.json` files. Bazel and pnpm will safely ignore these keys.

