#!/bin/zsh
set -euo pipefail
setopt typesetsilent

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$ROOT_DIR/docs"
PREVIEW_DIR="$ROOT_DIR/docs-preview"
PUBLISHED_DIR="$ROOT_DIR/gh-pages/docs"
TEMPLATE="$PREVIEW_DIR/template.html"
STYLE_SRC="$PREVIEW_DIR/styles.css"

mkdir -p "$PREVIEW_DIR" "$PUBLISHED_DIR"
cp "$STYLE_SRC" "$PUBLISHED_DIR/styles.css"

function path_prefix_to_root() {
  local rel="$1"
  local dir="${rel:h}"
  if [[ "$dir" == "$rel" || "$dir" == "." ]]; then
    printf '%s' ""
    return
  fi

  local prefix=""
  local remaining="$dir"
  while [[ -n "$remaining" && "$remaining" != "." ]]; do
    prefix+="../"
    if [[ "$remaining" == */* ]]; then
      remaining="${remaining#*/}"
    else
      remaining=""
    fi
  done
  printf '%s' "$prefix"
}

function build_tree() {
  local out_dir="$1"
  local site_root_base="$2"
  local brand_name="$3"

  while IFS= read -r source; do
    local rel="${source#$DOCS_DIR/}"
    local title
    title="$(sed -n 's/^# //p;q' "$source")"
    local target
    if [[ "$rel" == "README.md" ]]; then
      target="$out_dir/index.html"
    else
      target="$out_dir/${rel%.md}.html"
      mkdir -p "$(dirname "$target")"
    fi

    local docsroot
    docsroot="$(path_prefix_to_root "${rel%.md}.html")"
    local siteroot="${docsroot}${site_root_base}"

    pandoc \
      --from=gfm \
      --to=html5 \
      --standalone \
      --template="$TEMPLATE" \
      --metadata "title=$title" \
      --metadata "docsroot=$docsroot" \
      --metadata "siteroot=$siteroot" \
      --metadata "brandname=$brand_name" \
      "$source" \
      -o "$target"
  done < <(find "$DOCS_DIR" -type f -name '*.md' | sort)
}

build_tree "$PREVIEW_DIR" "../gh-pages/" "Fidra Docs Preview"
build_tree "$PUBLISHED_DIR" "../" "Fidra Docs"

echo "Docs preview built in $PREVIEW_DIR"
echo "Published docs built in $PUBLISHED_DIR"
