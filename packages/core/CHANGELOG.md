# brickflow

## 0.0.3

### Patch Changes

- 4b9f03d: Add onSuccess and onFailure handlers to Brick runs, preserving with as an alias for onFailure. Success handlers transform only the original Brick result, independently of failure handler order.
  
  Allow direct calls to Brick implementations and Layer-bound Bricks as an alternative to .run(params, options), preserving typed configuration and execution behavior.

## 0.0.2

### Patch Changes

- 4e8873b: Build package artifacts automatically before packing or publishing brickflow.
