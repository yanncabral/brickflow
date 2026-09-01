#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

pack_dir="$work_dir/pack"
consumer_dir="$work_dir/consumer"
mkdir -p "$pack_dir" "$consumer_dir"

npm pack "$repo_root/packages/core" --pack-destination "$pack_dir" --json --silent >/dev/null

mapfile -t tarballs < <(find "$pack_dir" -maxdepth 1 -type f -name '*.tgz')
if [[ "${#tarballs[@]}" -ne 1 ]]; then
  echo "Expected exactly one npm tarball, received ${#tarballs[@]}" >&2
  exit 1
fi
tarball="${tarballs[0]}"

mapfile -t files < <(tar -tzf "$tarball" | sed 's#^package/##' | sort)
allowed=(
  'README.md'
  'dist/index.d.ts'
  'dist/index.js'
  'dist/index.js.map'
  'package.json'
)
for file in "${files[@]}"; do
  if [[ ! " ${allowed[*]} " =~ " $file " ]]; then
    echo "Unexpected file in tarball: $file" >&2
    exit 1
  fi
done
for required in 'dist/index.js' 'dist/index.js.map' 'dist/index.d.ts' 'package.json'; do
  if [[ ! " ${files[*]} " =~ " $required " ]]; then
    echo "Missing $required in tarball" >&2
    exit 1
  fi
done

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
