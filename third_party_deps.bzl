load("@bazel_tools//tools/build_defs/repo:git.bzl", "git_repository")

def _third_party_deps_impl(ctx):
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
