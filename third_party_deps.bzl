load("@bazel_tools//tools/build_defs/repo:git.bzl", "git_repository")

def _third_party_deps_impl(ctx):
    # Fetch ezpz as an external Git repository.
    # Note: ezpz is not a Bazel module, so it cannot be fetched via bazel_dep.
    #
    # Why we patch and overlay here instead of using crate.annotation in MODULE.bazel:
    # 1. crate_universe only resolves and compiles the external registry dependencies (e.g. faer, winnow)
    #    of Cargo workspace members.
    # 2. The workspace members themselves (ezpz and ezpz-cli) are built using standard rust_* rules in
    #    our overlaid BUILD files.
    # 3. Because crate_universe does not manage the compilation of workspace members, we cannot use
    #    crate.annotation to apply patches to them. They must be patched at fetch time.
    git_repository(
        name = "ezpz",
        remote = "https://github.com/KittyCAD/ezpz.git",
        commit = "9ef9a4fc69f4258cf52eac0913ec513dd96384e3",
        build_file = "@//third_party/ezpz:ezpz.BUILD",
        patches = ["@//third_party/ezpz:ezpz.patch"],
        patch_args = ["-p3"],
    )

third_party_deps = module_extension(
    implementation = _third_party_deps_impl,
)
