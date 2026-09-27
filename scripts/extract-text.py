#!/usr/bin/env python3
"""Extract typed text (keyboard folio) from reMarkable .rm v6 files as Markdown.

Usage: extract-text.py <extracted_dir>
Prints Markdown to stdout. Handwriting is not extracted (no OCR).
Run via: uv run --with rmscene python3 scripts/extract-text.py ...
"""

import json
import sys
from pathlib import Path

from rmscene import read_blocks
from rmscene.scene_stream import RootTextBlock
from rmscene.text import TextDocument

STYLE_MD = {
    "HEADING": "# ",
    "BOLD": "**",
    "BULLET": "- ",
    "BULLET2": "  - ",
    "CHECKBOX": "- [ ] ",
    "CHECKBOX_CHECKED": "- [x] ",
    "PLAIN": "",
    "BASIC": "",
}


def page_order(extracted: Path) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for content_file in extracted.glob("*.content"):
        try:
            content = json.loads(content_file.read_text())
        except Exception:
            continue
        pages = content.get("cPages", {}).get("pages") or [
            {"id": p} for p in content.get("pages", [])
        ]
        index = 0
        for page in pages:
            if isinstance(page, dict) and page.get("deleted"):
                continue
            page_id = page["id"] if isinstance(page, dict) else page
            mapping[page_id] = index
            index += 1
    return mapping


def extract_page_text(rm_path: Path) -> str:
    with open(rm_path, "rb") as f:
        for block in read_blocks(f):
            if isinstance(block, RootTextBlock):
                doc = TextDocument.from_scene_item(block.value)
                lines = []
                for paragraph in doc.contents:
                    style = getattr(paragraph.style, "value", paragraph.style)
                    style_name = getattr(style, "name", str(style))
                    text = str(paragraph)
                    prefix = STYLE_MD.get(style_name, "")
                    if prefix == "**" and text.strip():
                        lines.append(f"**{text.strip()}**")
                    else:
                        lines.append(f"{prefix}{text}")
                return "\n".join(lines)
    return ""


def main(extracted_dir: str) -> None:
    extracted = Path(extracted_dir)
    rm_files = list(extracted.rglob("*.rm"))
    if not rm_files:
        print("", end="")
        return
    mapping = page_order(extracted)
    rm_files.sort(key=lambda f: mapping.get(f.stem, 999))

    pages = []
    for rm_file in rm_files:
        try:
            text = extract_page_text(rm_file)
        except Exception as error:
            print(f"warn: could not parse {rm_file.name}: {error}", file=sys.stderr)
            continue
        if text.strip():
            pages.append(text)
    print("\n\n---\n\n".join(pages))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
