# Agent style guidelines and project rules

All agentic AI coding assistants working in this repository must adhere to the following guidelines.

## Writing style and terminology
- **Google Developer Documentation Style Guide**: Follow the writing principles in the [Google Developer Documentation Style Guide](https://developers.google.com/style).
- **No randomly capitalized terms**: Do not capitalize general terms, common nouns, or general technical concepts (e.g., use "geometric constraint solver", "web assembly", "boundary representation", "canvas", "parametric design" in lowercase unless they start a sentence or refer to a specific product name/acronym like *WASM*, *Three.js*, *SolveSpace*, or *FreeCAD*).

## Code quality and readability
- **Professional standard**: Always assume you are writing code for professional, production-grade use by other engineers. 
- **Readability over cleverness**: Optimize code for readability, maintainability, and clean architecture, not just bare functionality.
- **Modular design**: Ensure components are highly modularized, decoupled, and cleanly separated.
- **Function size**: Keep functions concise. Functions exceeding 50 lines should be extremely rare; decompose complex logic into smaller, dedicated helper functions.
- **Documentation**: Document all public/exported symbols (classes, functions, interfaces, structs, packages) with rich, informative docstrings. Detail non-obvious design choices and edge cases.
- **Specification citations**: When implementing an algorithm that relies on a specification (e.g., an RFC document or standard paper), always cite the external sources clearly in the source code documentation.
- **Go style guide**: If writing Go code, strictly adhere to the [Uber Go Style Guide](https://github.com/uber-go/guide). In addition, apply the following design patterns:
  - **Domain-specific types**: Strongly prefer dedicated types over raw primitive types to improve type safety and readability (e.g., use `type EntityID string` instead of raw `string`, and write methods directly on `EntityID`).
  - **Type conversion helpers**: Provide explicit conversion functions for domain-specific primitives (e.g., `type Angle float64; func AngleFromRadians(rad float64) Angle`).
  - **Modern godoc comments**: Use modern Go doc comment syntax, including links to other symbols and external URLs.

## Iteration loop
- **Fast feedback loop**: Favor small, incremental changes.
- **Unit testing**: Get into a fast iteration loop quickly using tools like unit tests. Avoid running long-running processes or broad execution commands when localized tests can verify correctness.

## Markdown document formatting
- **Footnotes**: Markdown (`.md`) documents should use footnotes (`[^1]`) to explain reasoning, relationships, and context for decisions rather than just providing academic references.

## Git conventions
- **Semantic commits and pull requests**: Use semantic prefix naming for all commits and pull request titles (e.g., `feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `test:`, `chore:`). Keep titles descriptive and in lowercase except for proper nouns.


