#!/usr/bin/env node
/**
 * md-to-resumes.js
 * Reads a Markdown CV and a resumeFormats.md spec, then generates one styled
 * HTML resume per top-level heading in the spec, each in its own sub-folder.
 *
 * Usage:
 *   node md-to-resumes.js [cv.md] [resumeFormats.md]
 *   Defaults: Atkinson_CV.md and resumeFormats.md in the same directory.
 *
 * Relies on md-to-resume.js for parseMarkdown() and buildHTML().
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── Import helpers from single-resume script ──────────────────────────────────

const { parseMarkdown, buildHTML } = require("./md-to-resume.js");

// ── Parse resumeFormats.md ────────────────────────────────────────────────────
//
// Format file structure:
//
//   # Resume Name (output to '/folder/index.html')
//
//   - Section Name
//   - Section Name (instruction text)
//   - Parent Section
//     - Child Section (fold/integrate instruction)
//
// Each # heading = one resume.
// Top-level "- " items = sections to include (in order).
// Indented "  - " items = sections to fold into the preceding parent section.

function parseResumeFormats(md) {
  const lines = md.split("\n");
  const formats = [];
  let current = null;

  for (const line of lines) {
    const trim = line.trim();

    // ── Top-level heading → start a new resume format ──
    if (trim.startsWith("# ")) {
      if (current) formats.push(current);
      const headingText = trim.replace(/^#\s+/, "");
      // Extract (output to '…') annotation
      const outMatch = headingText.match(/\(output to ['"]([^'"]+)['"]\)/);
      current = {
        name: headingText.replace(/\s*\(output to [^)]+\)/, "").trim(),
        outputPath: outMatch ? outMatch[1] : null,
        sections: [],
      };

    // ── Top-level list item → section spec ──
    } else if (current && /^- /.test(line) && !/^\s{2,}/.test(line)) {
      const entry = line.replace(/^-\s+/, "").trim();
      // Split "Section Name (instruction)" — parenthetical is optional
      const m = entry.match(/^(.+?)(?:\s+\((.+)\))?$/);
      current.sections.push({
        name: (m ? m[1] : entry).trim(),
        instruction: m && m[2] ? m[2].trim() : null,
        folds: [],           // sections to fold into this one
      });

    // ── Indented list item → fold/integrate sub-instruction ──
    } else if (current && /^\s{2,}-\s/.test(line)) {
      const entry = line.replace(/^\s+-\s+/, "").trim();
      const m = entry.match(/^(.+?)(?:\s+\((.+)\))?$/);
      if (current.sections.length > 0) {
        current.sections[current.sections.length - 1].folds.push({
          name: (m ? m[1] : entry).trim(),
          instruction: m && m[2] ? m[2].trim() : null,
        });
      }
    }
  }

  if (current) formats.push(current);
  return formats;
}

// ── Section lookup helpers ────────────────────────────────────────────────────

/**
 * Find a top-level ## section by name (case-insensitive).
 * Returns the section object or null.
 */
function findTopLevelSection(cv, name) {
  const key = name.toLowerCase();
  return cv.sections.find(s => s.name.toLowerCase() === key) || null;
}

/**
 * Extract a ### sub-section's content lines from a parent section's content.
 * Returns just the lines belonging to that sub-section (heading line excluded),
 * or an empty array if the sub-section isn't found.
 */
function extractSubsection(contentLines, subName) {
  const key = subName.toLowerCase();
  const result = [];
  let inside = false;

  for (const line of contentLines) {
    const trim = line.trim();
    if (trim.startsWith("### ")) {
      inside = trim.replace(/^###\s+/, "").toLowerCase() === key;
      continue; // omit the ### heading itself
    }
    if (inside) result.push(line);
  }
  return result;
}

/**
 * Look up a section (or subsection) by name from the full CV.
 * Checks top-level ## sections first, then ### sub-sections within any section.
 * Returns { name, content } or null.
 */
function getSection(cv, name) {
  // 1. Direct top-level match
  const direct = findTopLevelSection(cv, name);
  if (direct) return direct;

  // 2. Sub-section match (e.g. "Bibliography" or "Curator" inside "Scholarship…")
  for (const section of cv.sections) {
    const subContent = extractSubsection(section.content, name);
    if (subContent.length > 0) {
      return { name, content: subContent };
    }
  }

  return null;
}

// ── Content transformation helpers ───────────────────────────────────────────

/**
 * Truncate a section's prose content to approximately maxWords words,
 * breaking cleanly at a sentence boundary where possible.
 */
function abbreviateSectionToWords(section, maxWords) {
  const fullText = section.content
    .filter(l => l.trim() !== "")
    .join(" ");
  const words = fullText.split(/\s+/);

  if (words.length <= maxWords) return section;

  let truncated = words.slice(0, maxWords).join(" ");
  const lastDot = truncated.lastIndexOf(". ");
  if (lastDot > truncated.length * 0.65) {
    truncated = truncated.slice(0, lastDot + 1);
  } else {
    truncated = truncated.trimEnd() + "…";
  }

  return { ...section, content: [truncated] };
}

/**
 * Produce an abbreviated version of a service section by retaining only the
 * bold heading lines (**Like This**) as a flat bullet list.
 */
function abbreviateToHeadings(section) {
  const headings = section.content
    .map(l => l.trim())
    .filter(l => /^\*\*[^*]+\*\*$/.test(l))
    .map(l => l.replace(/^\*\*|\*\*$/g, ""));

  if (headings.length === 0) return section;
  return { ...section, content: headings.map(h => `- ${h}`) };
}

// ── Date utilities (for reverse-chronological merge) ─────────────────────────

/**
 * Extract all calendar years from a text string, resolving short-year suffixes.
 * e.g. "2020–24" → [2020, 2024],  "2007–2023" → [2007, 2023]
 */
function extractYears(text) {
  const years = [];
  const re = /((?:19|20)\d{2})(?:[–\-](\d{2,4}|present))?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = parseInt(m[1]);
    years.push(start);
    if (m[2] && !/present/i.test(m[2])) {
      const n = parseInt(m[2]);
      // Short year suffix (e.g. "24" in "2020–24") → resolve to full year
      years.push(n < 100 ? Math.floor(start / 100) * 100 + n : n);
    }
  }
  return years;
}

/** Latest year in a date string; "present" → 9999. */
function getSortYear(dateStr) {
  if (!dateStr) return 0;
  if (/present/i.test(dateStr)) return 9999;
  const ys = extractYears(dateStr);
  return ys.length ? Math.max(...ys) : 0;
}

/** Earliest year in a date string (used as tiebreaker for "present" roles). */
function getStartYear(dateStr) {
  if (!dateStr) return 0;
  const ys = extractYears(dateStr);
  return ys.length ? Math.min(...ys) : 0;
}

// ── Professional Experience + Service merge ───────────────────────────────────

/**
 * Parse Professional Experience content into structured entry objects.
 * Each entry has the form: **Title** — _date_  followed by bullet lines.
 */
function parseProfExperienceEntries(contentLines) {
  const entries = [];
  let i = 0;

  while (i < contentLines.length) {
    const trim = contentLines[i].trim();
    if (!trim || trim === "---") { i++; continue; }

    // Match: **Title** — _date_  or  **Title** — *date*
    const m = trim.match(/^\*\*(.+?)\*\*\s*[—–\-]+\s*[_*](.+?)[_*]/);
    if (m) {
      const dateStr = m[2];
      const entry = {
        kind:        "experience",
        headerLine:  trim,
        dateStr,
        sortYear:    getSortYear(dateStr),
        startYear:   getStartYear(dateStr),
        bulletLines: [],
      };
      i++;
      while (i < contentLines.length) {
        const t = contentLines[i].trim();
        if (t === "---") { i++; break; }
        // Next entry header → stop (don't consume the line)
        if (t && /^\*\*(.+?)\*\*\s*[—–\-]+/.test(t)) break;
        if (t.startsWith("- ")) entry.bulletLines.push(t);
        i++;
      }
      entries.push(entry);
    } else {
      i++;
    }
  }

  return entries;
}

/**
 * Parse Professional Service content into entry objects.
 * Scans sub-items for year references to build a date range, and collects
 * all detail lines (plain text and bullets) to include in the merged output.
 */
function parseProfServiceEntries(contentLines) {
  const entries = [];
  let i = 0;

  while (i < contentLines.length) {
    const trim = contentLines[i].trim();
    if (!trim || trim === "---") { i++; continue; }

    const boldM = trim.match(/^\*\*([^*]+)\*\*$/);
    if (boldM) {
      const heading = boldM[1].trim();
      const years = [];
      const detailLines = [];
      i++;

      // Collect detail lines and extract year references until the next bold heading
      while (i < contentLines.length) {
        const t = contentLines[i].trim();
        if (/^\*\*[^*]+\*\*$/.test(t)) break; // next heading — stop, don't consume
        extractYears(t).forEach(y => years.push(y));
        if (t) detailLines.push(contentLines[i]); // keep non-empty lines
        i++;
      }

      let dateStr   = "";
      let sortYear  = 0;
      let startYear = 0;

      if (years.length) {
        sortYear  = Math.max(...years);
        startYear = Math.min(...years);
        if (sortYear === startYear) {
          dateStr = String(sortYear);
        } else {
          // Use short 2-digit suffix only for close ranges (≤9 year span, same decade).
          // Wider spans (e.g. 2007–2023) use the full end year for clarity.
          const span = sortYear - startYear;
          const endStr = span <= 9 && Math.floor(sortYear / 10) === Math.floor(startYear / 10)
            ? String(sortYear).slice(-2)
            : String(sortYear);
          dateStr = `${startYear}–${endStr}`;
        }
      }

      entries.push({
        kind:        "service",
        headerLine:  dateStr ? `**${heading}** — _${dateStr}_` : `**${heading}**`,
        dateStr,
        sortYear,
        startYear,
        bulletLines: detailLines,
      });
    } else {
      i++;
    }
  }

  return entries;
}

/**
 * Merge a Professional Experience section and a Professional Service section
 * into one reverse-chronological content block.
 * Service entries use headings + date only (no detail bullets).
 */
function mergeExperienceWithService(expSection, svcSection) {
  const expEntries = parseProfExperienceEntries(expSection.content);
  const svcEntries = parseProfServiceEntries(svcSection.content);

  const all = [...expEntries, ...svcEntries];

  // Primary sort: highest sortYear first.
  // Tiebreaker for two "present" roles: most recently started comes first.
  all.sort((a, b) =>
    b.sortYear !== a.sortYear
      ? b.sortYear - a.sortYear
      : b.startYear - a.startYear
  );

  // Reconstruct content lines in the format renderSectionContent understands
  const lines = [];
  for (const e of all) {
    lines.push(e.headerLine);
    for (const b of e.bulletLines) lines.push(b);
    lines.push("");
  }

  return { name: expSection.name, content: lines };
}

// ── Build a filtered CV object for one resume format ─────────────────────────

function buildFilteredCV(cv, format) {
  const filteredSections = [];

  for (const spec of format.sections) {
    const nameKey = spec.name.toLowerCase();
    const inst    = (spec.instruction || "").toLowerCase();

    // ── Profile ──────────────────────────────────────────────────────────────
    if (nameKey === "profile") {
      let section = getSection(cv, "Profile");
      if (!section) { console.warn("  ⚠  Section not found: Profile — skipping"); continue; }

      if (inst.includes("abbreviat")) {
        const wordMatch = inst.match(/\b(\d+)\s+words?\b/);
        section = abbreviateSectionToWords(section, wordMatch ? parseInt(wordMatch[1]) : 100);
      }

      filteredSections.push(section);
      continue;
    }

    // ── All other sections ────────────────────────────────────────────────────
    let section = getSection(cv, spec.name);
    if (!section) {
      console.warn(`  ⚠  Section not found: "${spec.name}" — skipping`);
      continue;
    }
    section = { name: section.name, content: [...section.content] };

    // Split folds into two passes:
    //   1. "integrate" folds — merge reverse-chronologically into section.content
    //   2. "append" folds   — appended as ### sub-sections afterwards
    // This order ensures appended blocks (e.g. University Service) always follow
    // the sorted dated entries, not intermingle with them.
    const integrateFolds = spec.folds.filter(f =>
      (f.instruction || "").toLowerCase().includes("integrate")
    );
    const appendFolds = spec.folds.filter(f =>
      !(f.instruction || "").toLowerCase().includes("integrate")
    );

    // Pass 1 — integrate (reverse-chronological merge)
    for (const fold of integrateFolds) {
      const foldSection = getSection(cv, fold.name);
      if (!foldSection) {
        console.warn(`  ⚠  Fold section not found: "${fold.name}" — skipping`);
        continue;
      }
      section = mergeExperienceWithService(section, foldSection);
    }

    // Pass 2 — append (abbreviated headings or full content)
    for (const fold of appendFolds) {
      const foldSection = getSection(cv, fold.name);
      if (!foldSection) {
        console.warn(`  ⚠  Fold section not found: "${fold.name}" — skipping`);
        continue;
      }
      const foldInst = (fold.instruction || "").toLowerCase();
      let foldContent = [...foldSection.content];
      if (foldInst.includes("abbreviat")) {
        foldContent = abbreviateToHeadings({ name: fold.name, content: foldContent }).content;
      }
      section.content.push("", `### ${fold.name}`, ...foldContent);
    }

    filteredSections.push(section);
  }

  return {
    name:     cv.name,
    contact:  cv.contact,
    bio:      cv.bio,
    sections: filteredSections,
  };
}

// ── Index page builder ───────────────────────────────────────────────────────

/**
 * Build a root index.html that links to every generated resume.
 * Inherits the same design tokens and fonts as the individual resumes.
 *
 * @param {object}   cv       – parsed CV object (used for the person's name)
 * @param {object[]} formats  – array of format objects from parseResumeFormats
 * @param {string}   baseDir  – absolute path of the directory containing index.html
 */
function buildIndexHTML(cv, formats, baseDir) {
  const { escapeHtml } = require("./md-to-resume.js");

  // Build one card per resume format
  const cards = formats.map(fmt => {
    // Compute the href relative to baseDir
    const outRel = fmt.outputPath
      || `/${fmt.name.toLowerCase().replace(/\s+/g, "-")}/index.html`;
    // Resolve to an absolute path, then make relative to baseDir
    const outAbs  = path.join(baseDir, outRel);
    const relHref = path.relative(baseDir, outAbs);

    // Strip trailing "/index.html" label for display; show just the folder slug
    const slug = relHref.replace(/\/index\.html$/, "").replace(/\\/g, "/");

    return `
    <a class="resume-card" href="${escapeHtml(relHref)}">
      <span class="card-name">${escapeHtml(fmt.name)}</span>
      <span class="card-arrow">→</span>
    </a>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(cv.name)} — Résumés</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@300;400&display=swap');

    :root {
      --bg:     #ffffff;
      --ink-1:  #1a1a1a;
      --ink-2:  #444444;
      --ink-3:  #555555;
      --ink-4:  #999999;
      --rule-1: #cccccc;
      --rule-2: #e8e8e8;
    }

    [data-theme="dark"] {
      --bg:     #161616;
      --ink-1:  #e2e2e2;
      --ink-2:  #b2b2b2;
      --ink-3:  #909090;
      --ink-4:  #5e5e5e;
      --rule-1: #383838;
      --rule-2: #2c2c2c;
    }

    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem;
      background: var(--bg);
      color: var(--ink-1);
      font-family: 'DM Sans', sans-serif;
      font-weight: 300;
      transition: background 0.2s, color 0.2s;
    }

    /* ── Theme toggle ── */
    .theme-toggle {
      position: fixed;
      top: 1rem;
      right: 1rem;
      display: flex;
      align-items: center;
      gap: 5px;
      background: var(--bg);
      border: 0.5px solid var(--rule-1);
      border-radius: 4px;
      color: var(--ink-4);
      cursor: pointer;
      padding: 5px 9px;
      font-size: 11px;
      font-family: 'DM Sans', sans-serif;
      font-weight: 300;
      letter-spacing: 0.04em;
      z-index: 100;
      transition: color 0.2s, border-color 0.2s, background 0.2s;
    }
    .theme-toggle:hover { color: var(--ink-2); border-color: var(--ink-4); }
    .theme-toggle svg   { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }

    /* ── Page content ── */
    .page {
      width: 100%;
      max-width: 480px;
    }

    .page-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 38px;
      font-weight: 400;
      letter-spacing: 0.02em;
      margin: 0 0 6px 0;
      line-height: 1.1;
    }

    .page-subtitle {
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink-4);
      margin: 0 0 2.5rem 0;
    }

    /* ── Resume cards ── */
    .cards {
      display: flex;
      flex-direction: column;
      gap: 0;
      border-top: 0.5px solid var(--rule-1);
    }

    .resume-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.1rem 0;
      border-bottom: 0.5px solid var(--rule-1);
      text-decoration: none;
      color: var(--ink-1);
      transition: color 0.15s;
    }

    .resume-card:hover { color: var(--ink-4); }

    .card-name {
      font-size: 14px;
      font-weight: 300;
      letter-spacing: 0.01em;
    }

    .card-arrow {
      font-size: 16px;
      color: var(--ink-4);
      transition: transform 0.15s, color 0.15s;
      flex-shrink: 0;
    }

    .resume-card:hover .card-arrow {
      transform: translateX(4px);
      color: var(--ink-2);
    }

    /* ── Mobile ── */
    @media (max-width: 480px) {
      body { padding: 2rem 1.25rem; }
      .page-name { font-size: 30px; }
    }

    /* ── Print ── */
    @media print { .theme-toggle { display: none; } }
  </style>
</head>
<body>

<button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
  <svg id="toggle-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path id="toggle-path" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>
  </svg>
  <span id="toggle-label">Dark</span>
</button>

<div class="page">
  <h1 class="page-name">${escapeHtml(cv.name)}</h1>
  <p class="page-subtitle">Select a résumé</p>
  <nav class="cards">
    ${cards}
  </nav>
</div>

<script>
  (function () {
    const root  = document.documentElement;
    const btn   = document.getElementById('theme-toggle');
    const label = document.getElementById('toggle-label');
    const path  = document.getElementById('toggle-path');
    const SUN   = 'M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7zm0-4a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V4a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zm9-9h-1a1 1 0 0 1 0-2h1a1 1 0 0 1 0 2zM4 12a1 1 0 0 1-1 1H2a1 1 0 0 1 0-2h1a1 1 0 0 1 1 1zm14.95 5.54-.7-.71a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1-1.41 1.42zm-13.9 0a1 1 0 0 1-1.41-1.41l.7-.71a1 1 0 1 1 1.42 1.42l-.71.7zM18.24 6.46a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.41 1.41l-.7.71a1 1 0 0 1-1.42 0zm-13.9 0a1 1 0 0 1-1.41 0l-.71-.71A1 1 0 0 1 3.63 4.34l.71.71a1 1 0 0 1 0 1.41z';
    const MOON  = 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z';
    function applyTheme(dark) {
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      path.setAttribute('d', dark ? SUN : MOON);
      label.textContent = dark ? 'Light' : 'Dark';
    }
    const saved = localStorage.getItem('cv-theme');
    applyTheme(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    btn.addEventListener('click', function () {
      const isDark = root.getAttribute('data-theme') === 'dark';
      applyTheme(!isDark);
      localStorage.setItem('cv-theme', isDark ? 'light' : 'dark');
    });
  })();
</script>

</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { spawnSync } = require("child_process");

const args        = process.argv.slice(2);
const scriptDir   = __dirname;

if (args.length === 0) {
  console.error("Usage: node md-to-resumes.js <source.md> [resumeFormats.md]");
  process.exit(1);
}

const cvPath      = path.resolve(args[0]);
const formatsPath = args[1] ? path.resolve(args[1]) : path.join(scriptDir, "resumeFormats.md");

if (!fs.existsSync(cvPath)) {
  console.error(`Error: CV file not found — ${cvPath}`);
  process.exit(1);
}
if (!fs.existsSync(formatsPath)) {
  console.error(`Error: Formats file not found — ${formatsPath}`);
  process.exit(1);
}

console.log(`\nCV:      ${cvPath}`);
console.log(`Formats: ${formatsPath}\n`);

// ── Full resume via md-to-resume.js ──────────────────────────────────────────
// Pass the same source .md to the single-resume script so the canonical full
// resume is always regenerated alongside the formatted variants.

console.log(`── Full resume (md-to-resume.js)`);
const single = spawnSync(
  process.execPath,                              // same node binary
  [path.join(scriptDir, "md-to-resume.js"), cvPath],
  { stdio: "inherit" }
);
if (single.status !== 0) {
  console.error("md-to-resume.js exited with an error — aborting.");
  process.exit(single.status ?? 1);
}
console.log();

// ── Formatted variants ────────────────────────────────────────────────────────

const cv      = parseMarkdown(fs.readFileSync(cvPath, "utf-8"));
const formats = parseResumeFormats(fs.readFileSync(formatsPath, "utf-8"));

console.log(`Generating ${formats.length} formatted resume(s):\n`);

for (const format of formats) {
  console.log(`── ${format.name}`);

  const filteredCV = buildFilteredCV(cv, format);
  const html       = buildHTML(filteredCV);

  const outRelPath = format.outputPath
    || `/${format.name.toLowerCase().replace(/\s+/g, "-")}/index.html`;
  const outAbsPath = path.join(scriptDir, outRelPath);

  fs.mkdirSync(path.dirname(outAbsPath), { recursive: true });
  fs.writeFileSync(outAbsPath, html, "utf-8");
  console.log(`   ✓  ${outAbsPath}\n`);
}

// ── Root index ────────────────────────────────────────────────────────────────

const indexPath = path.join(scriptDir, "index.html");
fs.writeFileSync(indexPath, buildIndexHTML(cv, formats, scriptDir), "utf-8");
console.log(`── Index\n   ✓  ${indexPath}\n`);

// ── PDF + DOCX exports ────────────────────────────────────────────────────────

const exports_ = spawnSync(
  process.execPath,
  [path.join(scriptDir, "html-to-exports.js"), formatsPath],
  { stdio: "inherit" },
);
if (exports_.status !== 0) {
  console.error("html-to-exports.js exited with an error.");
  process.exit(exports_.status ?? 1);
}

console.log("Done.\n");
