# brickflow

## 0.0.5

### Patch Changes

- bac4750: Generate execution IDs with Web Crypto instead of Node's crypto module so core works in browsers and Cloudflare Workers without Node compatibility flags. Fall back to a UUID v4 generated with `crypto.getRandomValues()` when `randomUUID` is unavailable, including in non-secure browser contexts.

## 0.0.4

### Patch Changes

- a8ccc34: Use onError as the primary typed error handler, matching the errors field in Brick contracts. Keep onFailure as a deprecated compatibility alias and preserve with as an alias for onError.

## 0.0.3

### Patch Changes

- 4b9f03d: Add onSuccess and onFailure handlers to Brick runs, preserving with as an alias for onFailure. Success handlers transform only the original Brick result, independently of failure handler order.
  
  Allow direct calls to Brick implementations and Layer-bound Bricks as an alternative to .run(params, options), preserving typed configuration and execution behavior.

## 0.0.2

### Patch Changes

- 4e8873b: Build package artifacts automatically before packing or publishing brickflow.
