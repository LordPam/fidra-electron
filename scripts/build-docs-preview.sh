#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$ROOT_DIR/docs"
OUT_DIR="$ROOT_DIR/docs-preview"
TEMPLATE="$OUT_DIR/template.html"

mkdir -p "$OUT_DIR"

while IFS= read -r source; do
  rel="${source#$DOCS_DIR/}"
  title="$(sed -n 's/^# //p;q' "$source")"
  if [[ "$rel" == "README.md" ]]; then
    target="$OUT_DIR/index.html"
  else
    target="$OUT_DIR/${rel%.md}.html"
    mkdir -p "$(dirname "$target")"
  fi

  pandoc \
    --from=gfm \
    --to=html5 \
    --standalone \
    --template="$TEMPLATE" \
    --metadata "title=$title" \
    "$source" \
    -o "$target"
done < <(find "$DOCS_DIR" -type f -name '*.md' | sort)

echo "Docs preview built in $OUT_DIR"
