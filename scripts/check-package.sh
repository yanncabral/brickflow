#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

pack_dir="$work_dir/pack"
consumer_dir="$work_dir/consumer"
mkdir -p "$pack_dir" "$consumer_dir"

pack_json="$(npm pack "$repo_root/packages/core" --pack-destination "$pack_dir" --json)"
tarball_name="$(node -e "const value = JSON.parse(process.argv[1]); const pack = Array.isArray(value) ? value[0] : Object.values(value)[0]; process.stdout.write(pack.filename)" "$pack_json")"
tarball="$pack_dir/$tarball_name"

node - "$pack_json" <<'NODE'
const value = JSON.parse(process.argv[2])
const pack = Array.isArray(value) ? value[0] : Object.values(value)[0]
const files = pack.files.map(({ path }) => path).sort()
const allowed = files.every(
  (path) => path === 'package.json' || path === 'README.md' || path.startsWith('dist/'),
)
if (!allowed) {
  throw new Error(`Unexpected files in tarball:\n${files.join('\n')}`)
}
for (const required of ['dist/index.js', 'dist/index.d.ts', 'package.json']) {
  if (!files.includes(required)) {
    throw new Error(`Missing ${required} in tarball`)
  }
}
NODE

cat > "$consumer_dir/package.json" <<EOF
{
  "name": "brickflow-package-smoke-test",
  "private": true,
  "type": "module",
  "dependencies": {
    "brickflow": "file:$tarball"
  }
}
EOF

npm install --prefix "$consumer_dir" --ignore-scripts --no-audit --no-fund

cat > "$consumer_dir/runtime.mjs" <<'EOF'
import { Layer, brick } from 'brickflow'

if (typeof brick !== 'function' || typeof Layer !== 'function') {
  throw new Error('brickflow runtime exports are unavailable')
}
EOF

node "$consumer_dir/runtime.mjs"

cat > "$consumer_dir/typecheck.ts" <<'EOF'
import { type Brick, brick, Layer } from 'brickflow'

type Greeting = Brick<{
  params: { name: string }
  result: string
}>

const greeting = brick<Greeting>(async ({ name }) => `Hello, ${name}!`)
new Layer('greetings', { greeting })
EOF

cat > "$consumer_dir/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "skipLibCheck": false,
    "noEmit": true
  },
  "include": ["typecheck.ts"]
}
EOF

"$repo_root/node_modules/.bin/tsc" -p "$consumer_dir/tsconfig.json"

mkdir -p "$work_dir/extracted"
tar -xzf "$tarball" -C "$work_dir/extracted"
if grep -R --fixed-strings '@brickflow/core' "$work_dir/extracted/package" >/dev/null; then
  echo 'Packed artifact references private package name @brickflow/core' >&2
  exit 1
fi
