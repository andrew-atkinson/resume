#!/usr/bin/env python3
"""
fix-table-headers.py
Post-processes a DOCX file to add a light-grey bottom border to the first
(header) row of every table.

Pandoc's HTML→DOCX conversion does not translate CSS border styles, so this
runs after pandoc to inject the OOXML border directly into each header cell.

Usage (called automatically by html-to-exports.js):
  python3 src/fix-table-headers.py <output.docx>
"""

import sys
from pathlib import Path

try:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
except ImportError:
    print("Error: python-docx not installed.")
    print("Run:   pip install python-docx --break-system-packages")
    sys.exit(1)

BORDER_COLOR = "cccccc"   # light grey — matches the section hairline rule
BORDER_SIZE  = 4          # 4 = 0.5 pt


def set_cell_bottom_border(cell, color=BORDER_COLOR, size=BORDER_SIZE):
    """Add (or replace) the bottom border on a single table cell."""
    tc = cell._tc

    tcPr = tc.find(qn("w:tcPr"))
    if tcPr is None:
        tcPr = OxmlElement("w:tcPr")
        tc.insert(0, tcPr)

    tcBorders = tcPr.find(qn("w:tcBorders"))
    if tcBorders is None:
        tcBorders = OxmlElement("w:tcBorders")
        tcPr.append(tcBorders)

    # Remove any existing bottom border definition
    existing = tcBorders.find(qn("w:bottom"))
    if existing is not None:
        tcBorders.remove(existing)

    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"),   "single")
    bottom.set(qn("w:sz"),    str(size))
    bottom.set(qn("w:space"), "0")
    bottom.set(qn("w:color"), color)
    tcBorders.append(bottom)


def fix_table_headers(docx_path: Path):
    doc = Document(str(docx_path))
    table_count = 0
    for table in doc.tables:
        if not table.rows:
            continue
        for cell in table.rows[0].cells:
            set_cell_bottom_border(cell)
        table_count += 1
    doc.save(str(docx_path))
    return table_count


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: fix-table-headers.py <file.docx>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"Error: file not found — {path}")
        sys.exit(1)

    n = fix_table_headers(path)
    print(f"✓  Added header borders to {n} table(s) in {path.name}")
