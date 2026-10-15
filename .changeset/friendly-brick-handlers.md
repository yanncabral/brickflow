---
"brickflow": patch
---

Add onSuccess and onFailure handlers to Brick runs, preserving with as an alias for onFailure. Success handlers transform only the original Brick result, independently of failure handler order.

Allow direct calls to Brick implementations and Layer-bound Bricks as an alternative to .run(params, options), preserving typed configuration and execution behavior.
