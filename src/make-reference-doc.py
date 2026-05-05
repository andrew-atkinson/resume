#!/usr/bin/env python3
"""
make-reference-doc.py
Generates src/reference.docx — the pandoc reference document used when
exporting résumés to DOCX.

Starts from pandoc's own default reference.docx (so all required styles
exist), then overrides typography, colour, spacing, and bullets to match
the HTML/PDF résumé design.

Usage:
  python3 src/make-reference-doc.py

Called automatically by html-to-exports.js when reference.docx is absent.

Fonts used:
  DM Sans          — body text  (install from fonts.google.com/specimen/DM+Sans)
  Cormorant Garamond — name/headings (fonts.google.com/specimen/Cormorant+Garamond)
  If either is not installed Word will substitute a similar font.
"""

import subprocess, sys, os
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Pt, RGBColor, Cm, Inches
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    from docx.enum.text import WD_LINE_SPACING
except ImportError:
    print("Error: python-docx not installed.")
    print("Run:   pip install python-docx --break-system-packages")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
OUT_PATH   = SCRIPT_DIR / "reference.docx"

# ── Colour palette (mirrors CSS tokens in md-to-resume.js) ───────────────────
INK_1 = RGBColor(0x1a, 0x1a, 0x1a)   # near-black, main text
INK_2 = RGBColor(0x44, 0x44, 0x44)   # dark grey, body
INK_3 = RGBColor(0x55, 0x55, 0x55)   # medium grey, bullets / lists
INK_4 = RGBColor(0x99, 0x99, 0x99)   # muted grey, section labels / dates
RULE  = "cccccc"                       # hairline rule colour (hex string)

BODY_FONT    = "Calibri"   # universally available (Mac + Windows)
HEADING_FONT = "Georgia"   # elegant serif, universally available

# ── XML helpers ───────────────────────────────────────────────────────────────

def get_style(doc, name):
    """
    python-docx 1.2+ lowercases the key via BabelFish before lookup, which
    breaks 'Heading 1' → 'heading 1' mismatches.  Iterate directly instead.
    Returns None if not found (caller should guard with 'if s:').
    """
    for s in doc.styles:
        if s.name == name:
            return s
    return None

def get_pPr(style):
    """Return the w:pPr element for a style, creating it if absent."""
    pPr = style.element.find(qn("w:pPr"))
    if pPr is None:
        pPr = OxmlElement("w:pPr")
        style.element.append(pPr)
    return pPr

def set_bool_prop(pPr, tag, value=True):
    """Set a boolean paragraph property (e.g. widowControl, keepNext)."""
    el = pPr.find(qn(tag))
    if el is None:
        el = OxmlElement(tag)
        pPr.append(el)
    el.set(qn("w:val"), "1" if value else "0")

def set_font_name(font, name):
    """
    Set all rFonts slots to bypass Word's theme-font inheritance.
    Without this, Normal/Heading styles may revert to Calibri/Cambria.
    """
    font.name = name
    rPr = font._element
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    for slot in ("w:ascii", "w:hAnsi", "w:cs"):
        rFonts.set(qn(slot), name)
    # Remove theme font references so explicit name takes precedence
    for slot in ("w:asciiTheme", "w:hAnsiTheme", "w:cstheme"):
        if rFonts.get(qn(slot)):
            del rFonts.attrib[qn(slot)]

def add_top_border(style, colour=RULE, size=4):
    """Add a hairline top border to a paragraph style."""
    pPr  = get_pPr(style)
    pBdr = pPr.find(qn("w:pBdr"))
    if pBdr is None:
        pBdr = OxmlElement("w:pBdr")
        pPr.append(pBdr)
    # Remove existing top if present
    existing = pBdr.find(qn("w:top"))
    if existing is not None:
        pBdr.remove(existing)
    top = OxmlElement("w:top")
    top.set(qn("w:val"),   "single")
    top.set(qn("w:sz"),    str(size))   # 4 = 0.5pt
    top.set(qn("w:space"), "4")
    top.set(qn("w:color"), colour)
    pBdr.append(top)

def set_spacing(pf, before_pt=0, after_pt=4, multiple=1.3):
    pf.space_before      = Pt(before_pt)
    pf.space_after       = Pt(after_pt)
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing      = multiple   # e.g. 1.3 = 1.3× line height

# ── Fetch pandoc's default reference.docx ────────────────────────────────────

import tempfile
tmp = Path(tempfile.gettempdir()) / "_pandoc_ref.docx"
result = subprocess.run(
    ["pandoc", "--print-default-data-file", "reference.docx"],
    capture_output=True,
)
if result.returncode != 0:
    print("Error: pandoc failed:", result.stderr.decode())
    sys.exit(1)

tmp.write_bytes(result.stdout)
doc = Document(str(tmp))
tmp.unlink()

# ── Page margins (match html-to-exports.js) ───────────────────────────────────
for section in doc.sections:
    section.top_margin    = Inches(0.75)
    section.bottom_margin = Inches(1.0)
    section.left_margin   = Cm(2.5)
    section.right_margin  = Cm(2.5)

# ── Normal ────────────────────────────────────────────────────────────────────
n = get_style(doc, "Normal")
set_font_name(n.font, BODY_FONT)
n.font.size      = Pt(10)
n.font.bold      = False
n.font.color.rgb = INK_2
set_spacing(n.paragraph_format, before_pt=0, after_pt=3, multiple=1.4)
pPr = get_pPr(n)
set_bool_prop(pPr, "w:widowControl", False)
set_bool_prop(pPr, "w:pageBreakBefore", False)

# ── Body Text (pandoc sometimes uses this for plain paragraphs) ───────────────
for sname in ("Body Text", "Body Text 2", "First Paragraph", "Compact"):
    s = get_style(doc, sname)
    if not s:
        continue
    set_font_name(s.font, BODY_FONT)
    s.font.size      = Pt(10)
    s.font.bold      = False
    s.font.color.rgb = INK_2
    set_spacing(s.paragraph_format, before_pt=0, after_pt=3, multiple=1.4)
    pPr = get_pPr(s)
    set_bool_prop(pPr, "w:widowControl", False)
    set_bool_prop(pPr, "w:pageBreakBefore", False)

# ── Title (metadata title — suppressed; we remove --metadata from pandoc call) ─
t = get_style(doc, "Title")
if t:
    t.font.size = Pt(1)
    set_spacing(t.paragraph_format, before_pt=0, after_pt=0)

# ── Heading 1 — résumé name ───────────────────────────────────────────────────
h1 = get_style(doc, "Heading 1")
set_font_name(h1.font, HEADING_FONT)
h1.font.size      = Pt(22)
h1.font.bold      = False
h1.font.italic    = False
h1.font.color.rgb = INK_1
h1.font.all_caps  = False
set_spacing(h1.paragraph_format, before_pt=0, after_pt=8, multiple=1.1)
pPr = get_pPr(h1)
set_bool_prop(pPr, "w:widowControl", False)
set_bool_prop(pPr, "w:pageBreakBefore", False)
set_bool_prop(pPr, "w:keepNext", True)

# ── Heading 2 — section labels (PROFILE, EDUCATION …) ────────────────────────
h2 = get_style(doc, "Heading 2")
set_font_name(h2.font, BODY_FONT)
h2.font.size      = Pt(12)   # larger than H3 (10.5pt) and body (10pt)
h2.font.bold      = False
h2.font.italic    = False
h2.font.all_caps  = True
h2.font.color.rgb = INK_4
set_spacing(h2.paragraph_format, before_pt=14, after_pt=4, multiple=1.0)
add_top_border(h2)
pPr = get_pPr(h2)
set_bool_prop(pPr, "w:widowControl", False)
set_bool_prop(pPr, "w:pageBreakBefore", False)
set_bool_prop(pPr, "w:keepNext", True)

# ── Heading 3 — sub-section labels (Photography, Bibliography …) ─────────────
h3 = get_style(doc, "Heading 3")
set_font_name(h3.font, BODY_FONT)
h3.font.size      = Pt(10.5)  # between H2 (12pt) and body (10pt)
h3.font.bold      = False
h3.font.italic    = False
h3.font.all_caps  = True
h3.font.color.rgb = INK_4
set_spacing(h3.paragraph_format, before_pt=10, after_pt=3, multiple=1.0)
pPr = get_pPr(h3)
set_bool_prop(pPr, "w:widowControl", False)
set_bool_prop(pPr, "w:pageBreakBefore", False)
set_bool_prop(pPr, "w:keepNext", True)

# ── Heading 4 — entry subtitles (org name + date line) ───────────────────────
# preprocessHTML converts .entry-subtitle divs to <h4>.  Slightly heavier than
# body text to signal a sub-entry without dominating the section label.
h4 = get_style(doc, "Heading 4")
if h4:
    set_font_name(h4.font, BODY_FONT)
    h4.font.size      = Pt(10)
    h4.font.bold      = True
    h4.font.italic    = False
    h4.font.all_caps  = False
    h4.font.color.rgb = INK_1
    set_spacing(h4.paragraph_format, before_pt=6, after_pt=1, multiple=1.3)
    pPr = get_pPr(h4)
    set_bool_prop(pPr, "w:widowControl", False)
    set_bool_prop(pPr, "w:pageBreakBefore", False)
    set_bool_prop(pPr, "w:keepNext", True)

# ── List Paragraph / List Bullet ──────────────────────────────────────────────
for sname in ("List Paragraph", "List Bullet", "List Bullet 2", "List Bullet 3"):
    s = get_style(doc, sname)
    if not s:
        continue
    set_font_name(s.font, BODY_FONT)
    s.font.size      = Pt(10)
    s.font.color.rgb = INK_3
    set_spacing(s.paragraph_format, before_pt=0, after_pt=2, multiple=1.4)
    s.paragraph_format.left_indent       = Cm(0.4)
    s.paragraph_format.first_line_indent = Cm(-0.4)
    pPr = get_pPr(s)
    set_bool_prop(pPr, "w:widowControl", False)
    set_bool_prop(pPr, "w:pageBreakBefore", False)

# ── Hyperlink — remove blue / underline ──────────────────────────────────────
hyp = get_style(doc, "Hyperlink")
if hyp:
    hyp.font.color.rgb = INK_3
    hyp.font.underline = False

# ── Strong ────────────────────────────────────────────────────────────────────
s = get_style(doc, "Strong")
if s:
    set_font_name(s.font, BODY_FONT)
    s.font.bold      = True
    s.font.color.rgb = INK_1

# ── Emphasis — serif italic, explicitly non-bold ─────────────────────────────
# bold = False (w:b w:val="0") is required so that <em> dates inside a
# <strong> entry-subtitle paragraph don't inherit the bold weight.
s = get_style(doc, "Emphasis")
if s:
    set_font_name(s.font, HEADING_FONT)
    s.font.italic    = True
    s.font.bold      = False   # explicit un-bold overrides any parent boldness
    s.font.color.rgb = INK_3

# ── Table styles ──────────────────────────────────────────────────────────────
# NOTE: "Table" is WD_STYLE_TYPE.TABLE (type 3) — do NOT include it here.
# Modifying a TABLE-type style via paragraph_format or font corrupts its XML
# and causes pandoc to render table content as plain text instead of a table.
# The named styles below ("Table Grid" etc.) don't exist in pandoc's default
# reference.docx so get_style() returns None for them and they are skipped
# harmlessly.  This loop is kept in case a future pandoc version adds them.
for sname in ("Table Grid", "Table Normal", "Table Contents", "Table Heading"):
    s = get_style(doc, sname)
    if not s:
        continue
    if s.font:
        set_font_name(s.font, BODY_FONT)
        s.font.size      = Pt(9)
        s.font.color.rgb = INK_2
    if hasattr(s, "paragraph_format") and s.paragraph_format:
        set_spacing(s.paragraph_format, before_pt=2, after_pt=2, multiple=1.2)

# ── Save ──────────────────────────────────────────────────────────────────────
doc.save(str(OUT_PATH))
print(f"✓  {OUT_PATH}")
