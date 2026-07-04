load("@aspect_rules_js//js:defs.bzl", _js_test = "js_test")

def js_test(node_options = [], **kwargs):
    """Wrapper around aspect_rules_js js_test to force ESM by default."""
    _js_test(
        node_options = node_options + ["--experimental-default-type=module"],
        **kwargs
    )
