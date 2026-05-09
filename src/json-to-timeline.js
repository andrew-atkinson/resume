#!/usr/bin/env node
/**
 * json-to-timeline.js — horizontal Gantt-style career timeline
 * X-axis: years, newest LEFT → oldest RIGHT
 * Y-axis: one row per category
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const cv       = JSON.parse(fs.readFileSync(path.join(__dirname, "Atkinson_CV.json"), "utf8"));
const sections = cv.sections;

// ── Layout constants ───────────────────────────────────────────────────────
const PX_PER_YEAR  = 80;
const MIN_YEAR     = 1993;
const MAX_YEAR     = 2028;
const PRESENT_YEAR = 2026;
const TOTAL_W      = (MAX_YEAR - MIN_YEAR) * PX_PER_YEAR;  // 2800 px

const LABEL_W      = 160;
const HEADER_H     =  48;
const SPAN_TRACK_H =  28;   // px per span swim-lane
const ITEM_H       =  17;   // px per list / point row
const BTN_H        =  20;   // px for the "+X more" button
const TOP_PAD      =   4;   // top padding inside each column

// ── Row definitions ────────────────────────────────────────────────────────
const ROWS = [
  { id: "education",     label: "Education",            mode: "spans"               },
  { id: "employment",    label: "Employment",            mode: "spans"               },
  { id: "teaching",      label: "Teaching",              mode: "spans"               },
  { id: "exhibitions",   label: "Exhibitions",           mode: "list",   maxLines: 4 },
  { id: "scholarship",   label: "Scholarship",           mode: "points", maxLines: 5 },
  { id: "presentations", label: "Presentations",         mode: "list",   maxLines: 2 },
  { id: "grants",        label: "Grants &\nResidencies", mode: "points", maxLines: 5 },
];

// ── Section / data helpers ─────────────────────────────────────────────────
function findSection(kw) {
  return sections.find(s => s.section.toLowerCase().includes(kw.toLowerCase()));
}
function allEntries(sec) {
  if (!sec) return [];
  if (sec.entries)     return sec.entries;
  if (sec.subsections) return sec.subsections.flatMap(ss => ss.entries || []);
  return [];
}

const data = {};
data.education     = allEntries(findSection("Education")).filter(e => e.year);
data.employment    = [
  ...allEntries(findSection("Professional Experience")),
  ...allEntries(findSection("Professional Service")),
].filter(e => e.year);
data.teaching      = allEntries(findSection("Classes Taught")).filter(e => e.year);
data.exhibitions   = allEntries(findSection("Exhibition")).filter(e => e.year);
data.scholarship   = allEntries(findSection("Scholarship")).filter(e => e.year);
data.presentations = allEntries(findSection("Presentation")).filter(e => e.year);
data.grants        = [
  ...allEntries(findSection("Grant")),
  ...allEntries(findSection("Residenc")),
].filter(e => e.year);

// ── Geometry (newest = LEFT) ───────────────────────────────────────────────
function xPos(year)  { return (MAX_YEAR - year) * PX_PER_YEAR; }
function effEnd(e)   { return e.present ? PRESENT_YEAR : (e.yearEnd || e.year + 1); }
function barLeft(e)  { return xPos(effEnd(e)); }
function barW(e)     { return (effEnd(e) - e.year) * PX_PER_YEAR; }

// ── Escaping ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || "")
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;");
}
// Escape for HTML attribute values (also encodes newlines so multi-line content
// round-trips through dataset correctly)
function escAttr(s) {
  return esc(s).replace(/\n/g, "&#10;").replace(/\r/g, "");
}

function entryLabel(e) { return e.title || e.content || ""; }
function fmtDate(e) {
  if (!e.year) return "";
  const s = String(e.year);
  if (e.present) return `${s}–present`;
  if (!e.yearEnd) return s;
  const sameDecade = Math.floor(e.yearEnd / 10) === Math.floor(e.year / 10);
  const eStr = (e.yearEnd - e.year <= 9 && sameDecade)
    ? String(e.yearEnd).slice(-2) : String(e.yearEnd);
  return `${s}–${eStr}`;
}

// Data attributes shared by every clickable entry
function entryDataAttrs(e) {
  let s = `data-title="${escAttr(entryLabel(e))}" `;
  if (e.place)   s += `data-place="${escAttr(e.place)}" `;
  s += `data-date="${escAttr(fmtDate(e))}" `;
  if (e.content) s += `data-content="${escAttr(e.content)}" `;
  if (e.link)    s += `data-link-url="${escAttr(e.link.url)}" data-link-title="${escAttr(e.link.linkTitle)}" `;
  return s;
}

// ── Track assignment ───────────────────────────────────────────────────────
function assignTracks(entries) {
  const sorted = [...entries].sort((a, b) => a.year - b.year);
  const trackEnds = [];
  const assignments = [];
  for (const e of sorted) {
    const end = effEnd(e);
    let t = trackEnds.findIndex(te => te <= e.year);
    if (t === -1) { t = trackEnds.length; trackEnds.push(end); }
    else trackEnds[t] = end;
    assignments.push({ entry: e, track: t });
  }
  return { assignments, numTracks: trackEnds.length };
}

// ── Grid lines ─────────────────────────────────────────────────────────────
function gridLines() {
  let h = "";
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) {
    h += `<div class="gl${y % 5 === 0 ? " gl-maj" : ""}" style="left:${xPos(y)}px;"></div>`;
  }
  return h;
}

// ── Year axis ──────────────────────────────────────────────────────────────
function renderYearAxis() {
  let h = `<div class="ya-track" style="width:${TOTAL_W}px;">`;
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) {
    const x = xPos(y), maj = y % 5 === 0;
    if (maj) h += `<div class="ya-lbl" style="left:${x}px;">${y}</div>`;
    h += `<div class="ya-tick${maj ? " ya-maj" : ""}" style="left:${x}px;"></div>`;
  }
  return h + `</div>`;
}

// ── Span renderer ──────────────────────────────────────────────────────────
function renderSpans(entries) {
  const { assignments, numTracks } = assignTracks(entries);
  const rowH = numTracks * SPAN_TRACK_H + 6;

  // Per-track sorted list (left→right = newest→oldest) for label max-width
  const byTrack = {};
  for (const { entry, track } of assignments) {
    (byTrack[track] = byTrack[track] || []).push(entry);
  }
  for (const t of Object.keys(byTrack)) {
    byTrack[t].sort((a, b) => barLeft(a) - barLeft(b));
  }

  let inner = gridLines();
  for (const { entry: e, track: t } of assignments) {
    const left  = barLeft(e);
    const w     = barW(e);
    const top   = t * SPAN_TRACK_H + 3;
    const lbl   = esc(entryLabel(e));
    const date  = esc(fmtDate(e));
    const arr   = byTrack[t];
    const idx   = arr.findIndex(x => x === e);
    const nextE = arr[idx + 1];
    const maxW  = Math.max(nextE ? barLeft(nextE) - left - 2 : TOTAL_W - left, w);

    inner +=
      `<div class="span-slot" style="left:${left}px;width:${w}px;top:${top}px;height:${SPAN_TRACK_H - 4}px;" ` +
      entryDataAttrs(e) + `>` +
      `<div class="sb-pill" style="max-width:${maxW}px;">` +
      `<span class="sb-lbl">${lbl}</span>` +
      `<span class="sb-date">${date}</span>` +
      `</div></div>`;
  }
  return { inner, height: rowH };
}

// ── Point renderer ─────────────────────────────────────────────────────────
function renderPoints(entries, rowDef) {
  const maxDots = rowDef.maxLines || 5;
  const byYear  = {};
  for (const e of entries) (byYear[e.year] = byYear[e.year] || []).push(e);

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);

  // Max label width: gap to the next older (rightward) occupied year
  const maxWidths = {};
  for (let i = 0; i < years.length; i++) {
    const y = years[i], olderY = years[i - 1];
    maxWidths[y] = olderY !== undefined
      ? Math.max((y - olderY) * PX_PER_YEAR - 6, 80)
      : Math.max(TOTAL_W - xPos(y), 80);
  }

  const maxStack = Math.max(...years.map(y => Math.min(byYear[y].length, maxDots)), 1);
  const rowH     = maxStack * ITEM_H + TOP_PAD + 4;

  let inner = gridLines();
  for (const y of years) {
    const items   = byYear[y];
    const x       = xPos(y);
    const mw      = maxWidths[y];
    const visible = items.slice(0, maxDots);
    const extra   = items.length - visible.length;

    inner += `<div class="pt-group" style="left:${x}px;max-width:${mw}px;">`;
    for (const e of visible) {
      inner +=
        `<div class="pt-row" ${entryDataAttrs(e)}>` +
        `<div class="pt-dot"></div>` +
        `<div class="pt-lbl">${esc(entryLabel(e))}</div>` +
        `</div>`;
    }
    if (extra > 0) inner += `<div class="pt-more">+${extra}</div>`;
    inner += `</div>`;
  }
  return { inner, height: rowH };
}

// ── List renderer (exhibitions + presentations) ────────────────────────────
// Shows up to `maxLines` items per year column; "+X more" button expands the
// rest with an animated max-height transition.  The containing row also
// animates its height so following rows slide down smoothly.
function renderList(entries, rowDef) {
  const maxLines = rowDef.maxLines || 4;
  const byYear   = {};
  for (const e of entries) (byYear[e.year] = byYear[e.year] || []).push(e);

  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);

  // Max label width: gap to next older year
  const maxWidths = {};
  for (let i = 0; i < years.length; i++) {
    const y = years[i], olderY = years[i - 1];
    maxWidths[y] = olderY !== undefined
      ? Math.max((y - olderY) * PX_PER_YEAR - 6, 80)
      : Math.max(TOTAL_W - xPos(y), 80);
  }

  let maxBaseH = ITEM_H + TOP_PAD;

  let inner = gridLines();
  for (const y of years) {
    const items    = byYear[y];
    const x        = xPos(y);
    const mw       = maxWidths[y];
    const hasExtra = items.length > maxLines;
    const visCount = Math.min(items.length, maxLines);
    const hBase    = TOP_PAD + visCount * ITEM_H + (hasExtra ? BTN_H : 0);
    const hFull    = TOP_PAD + items.length * ITEM_H + (hasExtra ? BTN_H : 0);
    maxBaseH       = Math.max(maxBaseH, hBase);

    inner += `<div class="exp-col" style="left:${x}px;max-width:${mw}px;" data-h-base="${hBase}" data-h-full="${hFull}">`;

    // Always-visible items
    for (const e of items.slice(0, maxLines)) {
      inner +=
        `<div class="lst-item" ${entryDataAttrs(e)}>` +
        `<span class="lst-lbl">${esc(entryLabel(e))}</span>` +
        `</div>`;
    }

    if (hasExtra) {
      // Extra items — JS will set max-height:0 on init and animate on expand
      inner += `<div class="exp-extra">`;
      for (const e of items.slice(maxLines)) {
        inner +=
          `<div class="lst-item" ${entryDataAttrs(e)}>` +
          `<span class="lst-lbl">${esc(entryLabel(e))}</span>` +
          `</div>`;
      }
      inner += `</div>`;

      inner += `<button class="exp-btn" data-n="${items.length - maxLines}">` +
               `+${items.length - maxLines} more</button>`;
    }

    inner += `</div>`;
  }

  return { inner, height: maxBaseH };
}

// ── Row dispatch ───────────────────────────────────────────────────────────
function renderRow(rowDef) {
  const entries = data[rowDef.id] || [];
  if (rowDef.mode === "spans")  return renderSpans(entries);
  if (rowDef.mode === "points") return renderPoints(entries, rowDef);
  return renderList(entries, rowDef);
}

// ── Full page ──────────────────────────────────────────────────────────────
function buildHTML() {
  const rendered = ROWS.map(r => ({ rowDef: r, ...renderRow(r) }));
  const rowsHTML = rendered.map(({ rowDef: r, inner, height }) => {
    const lbl = r.label.replace(/\n/g, "<br>");
    return (
      `<div class="cat-row row-${r.id}" style="height:${height}px;">` +
      `<div class="cat-label"><span>${lbl}</span></div>` +
      `<div class="cat-track" style="height:${height}px;">${inner}</div>` +
      `</div>`
    );
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(cv.name)} — Timeline</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@300;400&display=swap');

    :root {
      --bg:      #ffffff;
      --ink-1:   #1a1a1a;
      --ink-2:   #444444;
      --ink-3:   #555555;
      --ink-4:   #999999;
      --rule-1:  #cccccc;
      --rule-2:  #e8e8e8;
      --rule-3:  #f0f0f0;
      --accent:  #3a3a8c;
      /* Warm greys — same hue, three values */
      --clr-edu: #5a5350;   /* dark   warm grey */
      --clr-emp: #746e6a;   /* medium warm grey */
      --clr-tch: #8e8884;   /* light  warm grey */
    }
    [data-theme="dark"] {
      --bg:      #161616;
      --ink-1:   #e2e2e2;
      --ink-2:   #b2b2b2;
      --ink-3:   #909090;
      --ink-4:   #5e5e5e;
      --rule-1:  #383838;
      --rule-2:  #2c2c2c;
      --rule-3:  #222222;
      --accent:  #6a6acc;
      --clr-edu: #888280;
      --clr-emp: #a09a96;
      --clr-tch: #bab4b0;
    }

    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 2.5rem 2.5rem 5rem;
      background: var(--bg); color: var(--ink-1);
      font-family: 'DM Sans', sans-serif; font-weight: 300; font-size: 13px;
      transition: background 0.2s, color 0.2s;
    }

    /* ── Theme toggle ── */
    .theme-toggle {
      position: fixed; top: 1rem; right: 1rem; z-index: 600;
      display: flex; align-items: center; gap: 5px;
      background: var(--bg); border: 0.5px solid var(--rule-1); border-radius: 4px;
      color: var(--ink-4); cursor: pointer; padding: 5px 9px;
      font-size: 11px; font-family: 'DM Sans', sans-serif; font-weight: 300;
      letter-spacing: 0.04em; transition: color 0.2s, border-color 0.2s, background 0.2s;
    }
    .theme-toggle:hover { color: var(--ink-2); border-color: var(--ink-4); }
    .theme-toggle svg { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }

    /* ── Page header ── */
    .page-hd { margin-bottom: 2.5rem; }
    .page-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 36px; font-weight: 400; letter-spacing: 0.02em; margin: 0 0 4px;
    }
    .page-sub { font-size: 11px; color: var(--ink-4); letter-spacing: 0.08em; text-transform: uppercase; margin: 0; }

    /* ── Scroll wrapper ── */
    .tl-outer { overflow-x: auto; }
    .tl-wrap  { width: ${LABEL_W + TOTAL_W}px; }

    /* ── Year-axis (sticky top) ── */
    .ya-row {
      display: flex; position: sticky; top: 0; z-index: 50;
      background: var(--bg); border-bottom: 0.5px solid var(--rule-1);
    }
    .ya-spacer { flex: 0 0 ${LABEL_W}px; border-right: 0.5px solid var(--rule-1); }
    .ya-track  { position: relative; height: ${HEADER_H}px; }
    .ya-lbl {
      position: absolute; transform: translateX(-50%); top: 5px;
      font-size: 11px; color: var(--ink-4); letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums; user-select: none; white-space: nowrap;
    }
    .ya-tick         { position: absolute; bottom: 0; width: 0.5px; height: 7px;  background: var(--rule-1); }
    .ya-tick.ya-maj  { height: 14px; }

    /* ── Category rows ── */
    .cat-row {
      display: flex; border-bottom: 0.5px solid var(--rule-2);
      overflow: visible;      /* rows must be visible so expansions push siblings */
      position: relative;
    }
    .cat-row:last-child { border-bottom: none; }

    .cat-label {
      flex: 0 0 ${LABEL_W}px;
      display: flex; align-items: flex-start; justify-content: flex-end;
      padding: ${TOP_PAD}px 14px 0 0; text-align: right;
      font-size: 10px; color: var(--ink-4); letter-spacing: 0.07em; text-transform: uppercase; line-height: 1.5;
      border-right: 0.5px solid var(--rule-1); user-select: none;
    }
    .cat-track { position: relative; width: ${TOTAL_W}px; overflow: visible; }

    /* ── Grid lines ── */
    .gl        { position: absolute; top: 0; bottom: 0; width: 0.5px; background: var(--rule-3); pointer-events: none; }
    .gl.gl-maj { background: var(--rule-2); }

    /* ── Span bars ── */
    .span-slot { position: absolute; overflow: visible; cursor: pointer; }
    .sb-pill {
      display: flex; align-items: center; gap: 4px; padding: 0 6px;
      height: 100%; min-width: 100%;
      background: var(--bar-clr, var(--accent)); border-radius: 2px;
      overflow: hidden; opacity: 0.82; transition: opacity 0.15s;
    }
    .span-slot:hover .sb-pill { opacity: 1; position: relative; z-index: 10; }
    /* Per-category bar colours */
    .row-education  { --bar-clr: var(--clr-edu); }
    .row-employment { --bar-clr: var(--clr-emp); }
    .row-teaching   { --bar-clr: var(--clr-tch); }
    .sb-lbl  { font-size: 9.5px; color: #fff; white-space: nowrap; flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .sb-date { font-size: 8.5px; color: rgba(255,255,255,0.6); white-space: nowrap; flex: 0 0 auto; }

    /* ── Point events ── */
    .pt-group { position: absolute; top: ${TOP_PAD}px; overflow: hidden; }
    .pt-row   { display: flex; align-items: center; gap: 5px; height: ${ITEM_H}px; cursor: pointer; }
    .pt-dot   { width: 5px; height: 5px; border-radius: 50%; background: var(--ink-3); flex: 0 0 auto; }
    .pt-lbl   { font-size: 9.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pt-more  { font-size: 9px; color: var(--ink-4); padding-left: 10px; line-height: ${ITEM_H}px; }

    /* ── List columns (exhibitions, presentations) ── */
    .exp-col  { position: absolute; top: ${TOP_PAD}px; overflow: hidden; }
    .lst-item { height: ${ITEM_H}px; display: flex; align-items: center; cursor: pointer; }
    .lst-lbl  { font-size: 9.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Extra items: JS will set max-height:0 on init; transition added after first paint */
    .exp-extra { overflow: hidden; }

    .exp-btn {
      display: block; height: ${BTN_H}px; line-height: ${BTN_H}px;
      font-size: 9px; color: var(--ink-4);
      background: none; border: none; padding: 0;
      cursor: pointer; font-family: inherit; font-weight: 300;
      transition: color 0.15s;
    }
    .exp-btn:hover { color: var(--accent); }

    /* ── Hover label (floats above everything on mouse overflow) ── */
    #hover-lbl {
      display: none;
      position: fixed; z-index: 400;
      background: var(--bg); border: 0.5px solid var(--rule-1); border-radius: 3px;
      padding: 2px 8px;
      font-family: 'DM Sans', sans-serif; font-weight: 300;
      font-size: 10px; color: var(--ink-1);
      white-space: nowrap; pointer-events: none;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      transform: translateY(-110%);   /* appear just above the hovered row */
    }

    /* ── Detail popup ── */
    #dpop {
      display: none; position: fixed; inset: 0; z-index: 500;
      align-items: center; justify-content: center;
    }
    .dp-backdrop {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.25);
    }
    .dp-card {
      position: relative; z-index: 1;
      background: var(--bg); border: 0.5px solid var(--rule-1); border-radius: 6px;
      padding: 1.75rem 2rem 1.5rem;
      max-width: 520px; width: 90%;
      box-shadow: 0 12px 40px rgba(0,0,0,0.14);
    }
    .dp-close {
      position: absolute; top: 12px; right: 14px;
      background: none; border: none; padding: 0 4px;
      font-size: 20px; line-height: 1; color: var(--ink-4);
      cursor: pointer; font-family: inherit;
      transition: color 0.15s;
    }
    .dp-close:hover { color: var(--ink-1); }
    .dp-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 22px; font-weight: 400; color: var(--ink-1);
      margin: 0 0 8px; line-height: 1.3;
    }
    .dp-meta {
      font-size: 11px; color: var(--ink-4); margin-bottom: 12px;
      display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    }
    .dp-sep { color: var(--rule-1); }
    .dp-content {
      font-size: 12px; color: var(--ink-2);
      line-height: 1.65; white-space: pre-wrap; margin-bottom: 10px;
    }
    .dp-link {
      display: inline-block; font-size: 11px; color: var(--accent);
      text-decoration: none; border-bottom: 0.5px solid currentColor;
      transition: opacity 0.15s;
    }
    .dp-link:hover { opacity: 0.7; }
  </style>
</head>
<body>

<button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">
  <svg id="toggle-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path id="toggle-path" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>
  </svg>
  <span id="toggle-label">Dark</span>
</button>

<div class="page-hd">
  <h1 class="page-name">${esc(cv.name)}</h1>
  <p class="page-sub">Career Timeline</p>
</div>

<div class="tl-outer">
  <div class="tl-wrap">
    <div class="ya-row">
      <div class="ya-spacer"></div>
      ${renderYearAxis()}
    </div>
${rowsHTML}
  </div>
</div>

<!-- Hover label -->
<div id="hover-lbl"></div>

<!-- Detail popup -->
<div id="dpop" role="dialog" aria-modal="true">
  <div class="dp-backdrop" id="dp-backdrop"></div>
  <div class="dp-card">
    <button class="dp-close" id="dp-close" aria-label="Close">×</button>
    <div class="dp-title" id="dp-title"></div>
    <div class="dp-meta" id="dp-meta">
      <span id="dp-place"></span>
      <span class="dp-sep" id="dp-sep">·</span>
      <span id="dp-date"></span>
    </div>
    <div class="dp-content" id="dp-content"></div>
    <a class="dp-link" id="dp-link" href="#" target="_blank" rel="noopener noreferrer"></a>
  </div>
</div>

<script>
(function () {
  'use strict';

  /* ── 1. Theme toggle ── */
  const tBtn = document.getElementById('theme-toggle');
  const tLbl = document.getElementById('toggle-label');
  const tPth = document.getElementById('toggle-path');
  const SUN  = 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7z';
  const MOON = 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z';
  tBtn.addEventListener('click', function () {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    tLbl.textContent = dark ? 'Dark' : 'Light';
    tPth.setAttribute('d', dark ? MOON : SUN);
  });

  /* ── 2. Expand / collapse list rows ── */

  // Initialise: collapse all extras (set max-height before transition is wired up
  // so the initial state isn't animated)
  var extras = document.querySelectorAll('.exp-extra');
  extras.forEach(function (el) {
    el.style.maxHeight = '0';
    el.style.overflow  = 'hidden';
  });

  // Wire up height transitions after the first paint so the init doesn't animate
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      extras.forEach(function (el) {
        el.style.transition = 'max-height 0.35s ease';
      });
      document.querySelectorAll('.cat-row').forEach(function (row) {
        if (row.querySelector('.exp-col')) {
          row.style.transition = 'height 0.35s ease';
          var track = row.querySelector('.cat-track');
          if (track) track.style.transition = 'height 0.35s ease';
        }
      });
    });
  });

  function updateRowHeight(row) {
    var track = row.querySelector('.cat-track');
    var maxH  = 0;
    track.querySelectorAll('.exp-col').forEach(function (col) {
      var h = col.classList.contains('is-open')
        ? parseInt(col.dataset.hFull, 10)
        : parseInt(col.dataset.hBase, 10);
      if (h > maxH) maxH = h;
    });
    var newH = (maxH + 4) + 'px';
    row.style.height   = newH;
    track.style.height = newH;
  }

  /* ── 3. Hover label ── */
  var hoverLbl = document.getElementById('hover-lbl');

  document.addEventListener('mouseover', function (e) {
    // Match list items and point labels; sb-lbl inside span pills
    var el = e.target.closest('.lst-lbl, .pt-lbl, .sb-lbl');
    if (!el) { hoverLbl.style.display = 'none'; return; }
    // Only show when actually truncated
    if (el.scrollWidth <= el.offsetWidth + 1) { hoverLbl.style.display = 'none'; return; }
    var rect = el.getBoundingClientRect();
    hoverLbl.textContent   = el.textContent.trim();
    hoverLbl.style.left    = rect.left + 'px';
    hoverLbl.style.top     = (rect.bottom) + 'px';
    hoverLbl.style.display = 'block';
  });

  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('.lst-lbl, .pt-lbl, .sb-lbl')) {
      hoverLbl.style.display = 'none';
    }
  });

  /* ── 4. Detail popup ── */
  var dpop    = document.getElementById('dpop');
  var dpTitle = document.getElementById('dp-title');
  var dpPlace = document.getElementById('dp-place');
  var dpSep   = document.getElementById('dp-sep');
  var dpDate  = document.getElementById('dp-date');
  var dpCont  = document.getElementById('dp-content');
  var dpLink  = document.getElementById('dp-link');

  function openPopup(entry) {
    dpTitle.textContent = entry.dataset.title   || '';
    dpPlace.textContent = entry.dataset.place   || '';
    dpDate.textContent  = entry.dataset.date    || '';
    dpCont.textContent  = entry.dataset.content || '';
    dpSep.style.display   = (entry.dataset.place && entry.dataset.date) ? '' : 'none';
    dpPlace.style.display = entry.dataset.place   ? '' : 'none';
    dpCont.style.display  = entry.dataset.content ? '' : 'none';
    if (entry.dataset.linkUrl) {
      dpLink.href        = entry.dataset.linkUrl;
      dpLink.textContent = entry.dataset.linkTitle || entry.dataset.linkUrl;
      dpLink.style.display = '';
    } else {
      dpLink.style.display = 'none';
    }
    dpop.style.display = 'flex';
  }

  function closePopup() { dpop.style.display = 'none'; }

  /* ── Unified click handler ── */
  document.addEventListener('click', function (e) {

    /* Expand / collapse button */
    var expBtn = e.target.closest('.exp-btn');
    if (expBtn) {
      var col   = expBtn.closest('.exp-col');
      var extra = col.querySelector('.exp-extra');
      var row   = col.closest('.cat-row');
      var isOpen = col.classList.contains('is-open');
      if (isOpen) {
        extra.style.maxHeight = '0';
        col.classList.remove('is-open');
        expBtn.textContent = '+' + expBtn.dataset.n + ' more';
      } else {
        extra.style.maxHeight = extra.scrollHeight + 'px';
        col.classList.add('is-open');
        expBtn.textContent = 'Show less';
      }
      updateRowHeight(row);
      return;
    }

    /* Close popup */
    if (e.target.id === 'dp-backdrop' || e.target.id === 'dp-close' || e.target.closest('#dp-close')) {
      closePopup(); return;
    }
    if (dpop.style.display === 'flex' && !e.target.closest('.dp-card')) {
      closePopup(); return;
    }

    /* Open popup on entry click */
    var entry = e.target.closest('[data-title]');
    if (entry && !entry.matches('#dpop') && !entry.closest('#dpop')) {
      openPopup(entry);
    }
  });

  /* Escape key closes popup */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePopup();
  });

})();
</script>
</body>
</html>`;
}

// ── Write output ───────────────────────────────────────────────────────────
const outDir  = path.join(__dirname, "..", "timeline");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "index.html");
fs.writeFileSync(outPath, buildHTML(), "utf8");
console.log("✓  Timeline → " + outPath);
