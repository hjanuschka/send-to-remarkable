#!/usr/bin/env python3
"""Render reMarkable annotations onto the original PDF (or blank pages for notebooks).

Usage: render-annotations.py <extracted_dir> <output.pdf>
Run via: uv run --with rmscene,pymupdf python3 scripts/render-annotations.py ...
"""

import json
import sys
from pathlib import Path

import fitz  # PyMuPDF
from rmscene import read_blocks
from rmscene.scene_items import Line

RM_WIDTH = 1404
RM_HEIGHT = 1872

# reMarkable pen color codes -> RGB (0..1)
COLORS = {
    0: (0, 0, 0),        # black
    1: (0.45, 0.45, 0.45),  # gray
    2: (1, 1, 1),        # white / eraser
    3: (1, 0.85, 0.1),   # yellow highlighter
    4: (0.2, 0.55, 0.2), # green
    5: (0.85, 0.25, 0.55),  # pink
    6: (0.2, 0.35, 0.8), # blue
    7: (0.75, 0.15, 0.15),  # red
    8: (0.55, 0.55, 0.55),  # gray overlap
}


def extract_strokes(rm_path: Path) -> list[dict]:
    strokes = []
    with open(rm_path, "rb") as f:
        try:
            for block in read_blocks(f):
                value = getattr(block, "item", None)
                value = getattr(value, "value", None) if value is not None else None
                if value is None:
                    value = getattr(block, "value", None)
                if isinstance(value, Line):
                    points = [(p.x, p.y) for p in value.points]
                    color_attr = getattr(value, "color", 0)
                    color_code = getattr(color_attr, "value", color_attr)
                    strokes.append({
                        "points": points,
                        "color": COLORS.get(color_code, (0, 0, 0)),
                        "width": max(0.5, float(getattr(value, "thickness_scale", 1.0)) * 1.5),
                    })
        except Exception as error:  # unsupported block versions: keep what we got
            print(f"warn: partial parse of {rm_path.name}: {error}", file=sys.stderr)
    return strokes


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


def main(extracted_dir: str, output_pdf: str) -> None:
    extracted = Path(extracted_dir)
    rm_files = sorted(extracted.rglob("*.rm"))
    if not rm_files:
        print("no .rm files found - nothing to render", file=sys.stderr)
        sys.exit(2)

    mapping = page_order(extracted)
    pdfs = [p for p in extracted.glob("*.pdf")]

    if pdfs:
        doc = fitz.open(pdfs[0])
    else:
        doc = fitz.open()
        count = max((mapping.get(f.stem, 0) for f in rm_files), default=0) + 1
        for _ in range(count):
            doc.new_page(width=RM_WIDTH / 2, height=RM_HEIGHT / 2)

    drawn = 0
    for rm_file in rm_files:
        page_num = mapping.get(rm_file.stem, 0)
        if page_num >= len(doc):
            continue
        page = doc[page_num]
        scale_x = page.rect.width / RM_WIDTH
        scale_y = page.rect.height / RM_HEIGHT
        # reMarkable x coordinates are centered on 0 for v6 files
        for stroke in extract_strokes(rm_file):
            pts = [((x + RM_WIDTH / 2) * scale_x, y * scale_y) for x, y in stroke["points"]]
            if len(pts) < 2:
                continue
            shape = page.new_shape()
            shape.draw_polyline(pts)
            shape.finish(color=stroke["color"], width=stroke["width"], lineCap=1, lineJoin=1)
            shape.commit()
            drawn += 1

    doc.save(output_pdf)
    print(f"rendered {drawn} strokes -> {output_pdf}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
