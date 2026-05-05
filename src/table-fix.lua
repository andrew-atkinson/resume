-- table-fix.lua
-- Pandoc Lua filter — compatible with both the old (≤ 2.10) and new (2.11+)
-- Table AST.
--
-- Table handler:
--   • Sets all column alignments to AlignLeft.
--   • Sets proportional column widths (fractions of text width, sum ≤ 1)
--     so the table spans the full page column without overflow.
--
-- BulletList handler:
--   • Converts every bullet-list item to a plain paragraph (no bullet
--     character, no indent).  Mirrors the HTML which uses list-style:none.

local function column_widths(n)
  if n <= 0 then return {} end
  if n == 1 then return { 1.0 } end
  if n == 2 then return { 0.28, 0.72 } end
  if n == 3 then return { 0.18, 0.27, 0.55 } end
  -- 4+ columns: even split
  local each = math.floor(100 / n) / 100
  local widths = {}
  local sum = 0
  for i = 1, n - 1 do
    widths[i] = each
    sum = sum + each
  end
  widths[n] = tonumber(string.format("%.2f", 1.0 - sum))
  return widths
end

function Table(el)
  -- ── pandoc 2.11+ API: el.colspecs = list of {alignment, colwidth} pairs ──
  if el.colspecs then
    local n = #el.colspecs
    if n == 0 then return el end
    local widths = column_widths(n)
    for i = 1, n do
      el.colspecs[i] = { pandoc.AlignLeft, widths[i] }
    end

  -- ── pandoc ≤ 2.10 API: el.aligns and el.widths as separate lists ──
  elseif el.aligns then
    local n = #el.aligns
    if n == 0 then return el end
    local widths = column_widths(n)
    for i = 1, n do
      el.aligns[i]  = pandoc.AlignLeft
      el.widths[i]  = widths[i]
    end
  end

  return el
end

-- ── BulletList → plain paragraphs ────────────────────────────────────────────
--
-- The HTML résumé uses list-style:none — visually there are no bullet markers.
-- This filter reproduces that for DOCX by flattening every BulletList into the
-- sequence of Para blocks that its items contain.

function BulletList(el)
  local blocks = {}
  for _, item in ipairs(el.content) do
    for _, block in ipairs(item) do
      table.insert(blocks, block)
    end
  end
  return blocks
end
