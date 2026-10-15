---
"brickflow": patch
---

Allow required Brick operations to be awaited directly inside handlers while preserving typed failure propagation, operation forwarding, and generic overload inference. Keep detached failures at the public error boundary and remove Node built-in dependencies from core for browser and Cloudflare Workers compatibility.
