# Agent Style Guidelines and Project Rules

All agentic AI coding assistants working in this repository must adhere to the following guidelines.

## Writing Style & Terminology
- **Google Developer Documentation Style Guide**: Follow the writing principles in the [Google Developer Documentation Style Guide](https://developers.google.com/style).
- **No Randomly Capitalized Terms**: Do not capitalize general terms, common nouns, or general technical concepts (e.g., use "geometric constraint solver", "web assembly", "boundary representation", "canvas", "parametric design" in lowercase unless they start a sentence or refer to a specific product name/acronym like *WASM*, *Three.js*, *SolveSpace*, or *FreeCAD*).

## Code Quality & Readability
- **Professional Standard**: Always assume you are writing code for professional, production-grade use by other engineers. 
- **Readability Over Cleverness**: Optimize code for readability, maintainability, and clean architecture, not just bare functionality.
- **Modular Design**: Ensure components are highly modularized, decoupled, and cleanly separated.
- **Documentation**: Write clear, precise comments and docstrings. Document non-obvious design choices.
- **Go Style Guide**: If writing Go code, strictly adhere to the [Uber Go Style Guide](https://github.com/uber-go/guide).

## Iteration Loop
- **Fast Feedback Loop**: Favor small, incremental changes.
- **Unit Testing**: Get into a fast iteration loop quickly using tools like unit tests. Avoid running long-running processes or broad execution commands when localized tests can verify correctness.

## Markdown Document Formatting
- **Footnotes**: Markdown (`.md`) documents should use footnotes (`[^1]`) to explain reasoning, relationships, and context for decisions rather than just providing academic references.
