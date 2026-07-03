# Agent style guidelines and project rules

All agentic AI coding assistants working in this repository must adhere to the following guidelines.

## Writing style and terminology
- **Google Developer Documentation Style Guide**: Follow the writing principles in the [Google Developer Documentation Style Guide](https://developers.google.com/style).
- **No randomly capitalized terms**: Do not capitalize general terms, common nouns, or general technical concepts (e.g., use "geometric constraint solver", "web assembly", "boundary representation", "canvas", "parametric design" in lowercase unless they start a sentence or refer to a specific product name/acronym like *WASM*, *Three.js*, *SolveSpace*, or *FreeCAD*).

## Code quality and readability
- **Professional standard**: Always assume you are writing code for professional, production-grade use by other engineers. 
- **Readability over cleverness**: Optimize code for readability, maintainability, and clean architecture, not just bare functionality.
- **Modular design**: Ensure components are highly modularized, decoupled, and cleanly separated.
- **Documentation**: Write clear, precise comments and docstrings. Document non-obvious design choices.
- **Go style guide**: If writing Go code, strictly adhere to the [Uber Go Style Guide](https://github.com/uber-go/guide).

## Iteration loop
- **Fast feedback loop**: Favor small, incremental changes.
- **Unit testing**: Get into a fast iteration loop quickly using tools like unit tests. Avoid running long-running processes or broad execution commands when localized tests can verify correctness.

## Markdown document formatting
- **Footnotes**: Markdown (`.md`) documents should use footnotes (`[^1]`) to explain reasoning, relationships, and context for decisions rather than just providing academic references.

