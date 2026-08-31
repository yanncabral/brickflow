#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

pack_dir="$work_dir/pack"
consumer_dir="$work_dir/consumer"
mkdir -p "$pack_dir" "$consumer_dir"

pack_json="$(npm pack "$repo_root/packages/core" --pack-destination "$pack_dir" --json)"
tarball_name="$(node - "$pack_json" <<'NODE'
const value = JSON.parse(process.argv[2])
const entries = Array.isArray(value)
  ? value
  : value !== null && typeof value === 'object'
    ? Object.values(value)
    : []

if (entries.length !== 1) {
  throw new Error(`Expected exactly one npm pack entry, received ${entries.length}`)
}

const [pack] = entries
if (pack === null || typeof pack !== 'object') {
  throw new Error('Invalid npm pack entry: expected an object')
}
if (typeof pack.filename !== 'string' || pack.filename.length === 0) {
  throw new Error('Invalid npm pack entry: filename must be a non-empty string')
}
if (
  !Array.isArray(pack.files) ||
  pack.files.some(
    (file) =>
      file === null ||
      typeof file !== 'object' ||
      typeof file.path !== 'string',
  )
) {
  throw new Error('Invalid npm pack entry: files must contain string path values')
}

const files = pack.files.map(({ path }) => path).sort()
const allowed = new Set([
  'README.md',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.js.map',
  'package.json',
])
const disallowed = files.filter((path) => !allowed.has(path))
if (disallowed.length > 0) {
  throw new Error(`Unexpected files in tarball:\n${disallowed.join('\n')}`)
}
for (const required of ['dist/index.js', 'dist/index.js.map', 'dist/index.d.ts', 'package.json']) {
  if (!files.includes(required)) {
    throw new Error(`Missing ${required} in tarball`)
  }
}

process.stdout.write(pack.filename)
NODE
)"
tarball="$pack_dir/$tarball_name"

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
set +e
grep -R --fixed-strings '@brickflow/core' "$work_dir/extracted/package" >/dev/null
grep_status=$?
set -e
case "$grep_status" in
  0)
    echo 'Packed artifact references private package name @brickflow/core' >&2
    exit 1
    ;;
  1) ;;
  *)
    echo "Failed to scan packed artifact for @brickflow/core (grep exited $grep_status)" >&2
    exit "$grep_status"
    ;;
esac
