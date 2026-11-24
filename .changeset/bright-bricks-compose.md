---
"brickflow": patch
---

- Rename the Brick contract field `errors` to `error`. Update existing contracts to use the singular field, including contracts that declare a union of failures.
- Allow `brick<Contract, Config>()` to add implementation-specific providers and Brick dependencies through `requires` and `depends`.
- Validate providers against the concrete dependency graph selected by the Layer. Bound calls also expose typed failures from the selected implementations' dependencies.
- Include installation instructions and a quick-start example in the npm package README.
