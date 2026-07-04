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

### Syncing BUILD Files (Gazelle)
We use the **Aspect Gazelle plugin** to automatically generate and maintain `BUILD.bazel` files for TypeScript targets. If you add new source files, rename files, or add/remove dependencies in `package.json`, run:
```bash
./devtools/gaz
```
This will automatically update the `ts_project` and `npm_package` rules.

## Adding Comments in `package.json`
Since JSON does not support comments, we use the `"//"` key convention to document the purpose of dependencies or metadata fields in `package.json` files. Bazel and pnpm will safely ignore these keys.
