#!/usr/bin/env node
/**
 * md-to-resumes.js
 * Accepts a Markdown CV, generates the JSON via resume-to-json.js, then
 * produces one styled HTML resume per format defined in resumeFormats.md.
 *
 * Usage:
 *   node src/md-to-resumes.js [cv.md] [resumeFormats.md]
 *   Defaults: the single .md file in src/ and resumeFormats.md beside it.
 *
 * Pipeline:
 *   1. Parse CV .md → { name, contact, sections[] }  (resume-to-json.js)
 *   2. Write .json file beside the .md
 *   3. For each format in resumeFormats.md:
 *        filter / transform sections from the JSON → buildHTMLFromJSON → write HTML
 *   4. Write root index.html
 *   5. Run html-to-exports.js (PDF + DOCX)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const { parseCV }          = require("./resume-to-json.js");
const { buildHTMLFromJSON, escapeHtml } = require("./md-to-resume.js");

// ── Parse resumeFormats.md ────────────────────────────────────────────────────
//
//   # Resume Name (output to '/folder/index.html')
//   - Section Name
//   - Section Name (instruction)
//   - Parent Section
//     - Child Section (fold/integrate instruction)

function parseResumeFormats(md) {
  const lines   = md.split("\n");
  const formats = [];
  let current   = null;

  for (const line of lines) {
    const trim = line.trim();

    if (trim.startsWith("# ")) {
      if (current) formats.push(current);
      const headingText = trim.replace(/^#\s+/, "");
      const outMatch    = headingText.match(/\(output to ['"]([^'"]+)['"]\)/);
      current = {
        name:       headingText.replace(/\s*\(output to [^)]+\)/, "").trim(),
        outputPath: outMatch ? outMatch[1] : null,
        sections:   [],
      };

    } else if (current && /^- /.test(line) && !/^\s{2,}/.test(line)) {
      const entry = line.replace(/^-\s+/, "").trim();
      const m     = entry.match(/^(.+?)(?:\s+\((.+)\))?$/);
      current.sections.push({
        name:        (m ? m[1] : entry).trim(),
        instruction: m && m[2] ? m[2].trim() : null,
        folds:       [],
      });

    } else if (current && /^\s{2,}-\s/.test(line)) {
      const entry = line.replace(/^\s+-\s+/, "").trim();
      const m     = entry.match(/^(.+?)(?:\s+\((.+)\))?$/);
      if (current.sections.length > 0) {
        current.sections[current.sections.length - 1].folds.push({
          name:        (m ? m[1] : entry).trim(),
          instruction: m && m[2] ? m[2].trim() : null,
        });
      }
    }
  }

  if (current) formats.push(current);
  return formats;
}

// ── Section lookup ────────────────────────────────────────────────────────────

/**
 * Find a section by name from the JSON sections array.
 * Checks top-level section names first, then subsection titles.
 * Returns a copy of the section object or null.
 *
 * @param {object[]} sections  – the sections array from parseCV()
 * @param {string}   name
 * @returns {{ section: string, entries?: object[], subsections?: object[] } | null}
 */
function getSection(sections, name) {
  const key = name.toLowerCase().trim();

  // 1. Direct top-level match
  const direct = sections.find(s => s.section.toLowerCase() === key);
  if (direct) return JSON.parse(JSON.stringify(direct));   // deep clone

  // 2. Sub-section title match (e.g. "Curator" inside "Scholarship…")
  for (const sec of sections) {
    if (!sec.subsections) continue;
    const sub = sec.subsections.find(s => s.title.toLowerCase() === key);
    if (sub) {
      // Return as a synthetic flat section
      return { section: sub.title, entries: JSON.parse(JSON.stringify(sub.entries)) };
    }
  }

  return null;
}

// ── Content transformation helpers ───────────────────────────────────────────

/**
 * Truncate a Profile section to approximately maxWords words,
 * breaking at a sentence boundary where possible.
 */
function abbreviateSectionToWords(section, maxWords) {
  const entries = section.entries || [];
  if (!entries.length) return section;

  const fullText = entries.map(e => e.content || "").join(" ");
  const words    = fullText.split(/\s+/);
  if (words.length <= maxWords) return section;

  let truncated  = words.slice(0, maxWords).join(" ");
  const lastDot  = truncated.lastIndexOf(". ");
  if (lastDot > truncated.length * 0.65) {
    truncated = truncated.slice(0, lastDot + 1);
  } else {
    truncated = truncated.trimEnd() + "…";
  }

  return { section: section.section, entries: [{ content: truncated }] };
}

// ── Sort helpers (for chronological merge) ────────────────────────────────────

/** Sort key: present roles sort highest (9999), then by yearEnd, then year. */
function sortYear(entry) {
  if (entry.present)  return 9999;
  if (entry.yearEnd)  return entry.yearEnd;
  return entry.year || 0;
}

function startYear(entry) {
  return entry.year || 0;
}

// ── Professional Experience + Service merge ───────────────────────────────────

/**
 * Merge a Professional Experience section and a Professional Service section
 * into one reverse-chronological entries array.
 */
function mergeExperienceWithService(expSection, svcSection) {
  const expEntries = (expSection.entries || []);
  const svcEntries = (svcSection.entries || []);

  const merged = [...expEntries, ...svcEntries].sort((a, b) => {
    const sy = sortYear(b) - sortYear(a);
    if (sy !== 0) return sy;
    return startYear(b) - startYear(a);
  });

  return { section: expSection.section, entries: merged };
}

// ── Build filtered CV object for one resume format ────────────────────────────

/**
 * Assemble a { name, contact, sections[] } object containing only the sections
 * specified by the format, with any abbreviations and folds applied.
 */
function buildFilteredCV(cv, format) {
  const filteredSections = [];

  for (const spec of format.sections) {
    const inst = (spec.instruction || "").toLowerCase();

    let section = getSection(cv.sections, spec.name);
    if (!section) {
      console.warn(`  ⚠  Section not found: "${spec.name}" — skipping`);
      continue;
    }

    // ── Profile abbreviation ──────────────────────────────────────────────────
    if (section.section === "Profile" && inst.includes("abbreviat")) {
      const wordMatch = inst.match(/\b(\d+)\s+words?\b/);
      section = abbreviateSectionToWords(section, wordMatch ? parseInt(wordMatch[1]) : 100);
    }

    // ── Folds ─────────────────────────────────────────────────────────────────
    const integrateFolds = spec.folds.filter(f =>
      (f.instruction || "").toLowerCase().includes("integrate")
    );
    const appendFolds = spec.folds.filter(f =>
      !(f.instruction || "").toLowerCase().includes("integrate")
    );

    // Pass 1 — integrate: reverse-chronological merge
    for (const fold of integrateFolds) {
      const foldSection = getSection(cv.sections, fold.name);
      if (!foldSection) {
        console.warn(`  ⚠  Fold section not found: "${fold.name}" — skipping`);
        continue;
      }
      section = mergeExperienceWithService(section, foldSection);
    }

    // Pass 2 — append: add as a subsection block
    for (const fold of appendFolds) {
      const foldSection = getSection(cv.sections, fold.name);
      if (!foldSection) {
        console.warn(`  ⚠  Fold section not found: "${fold.name}" — skipping`);
        continue;
      }
      if (!section.subsections) section.subsections = [];
      section.subsections.push({
        title:   fold.name,
        entries: foldSection.entries || [],
      });
    }

    filteredSections.push(section);
  }

  return { name: cv.name, contact: cv.contact, sections: filteredSections };
}

// ── Index page builder ────────────────────────────────────────────────────────

function buildIndexHTML(cv, formats, baseDir) {
  const lastName  = cv.name.split(/\s+/).pop() || "Resume";
  const FILE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 15" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1H2.5A1.5 1.5 0 0 0 1 2.5v10A1.5 1.5 0 0 0 2.5 14h7A1.5 1.5 0 0 0 11 12.5V5L7 1z"/><path d="M7 1v4h4"/></svg>`;

  const cards = formats.map(fmt => {
    const outRel  = fmt.outputPath
      || `/${fmt.name.toLowerCase().replace(/\s+/g, "-")}/index.html`;
    const outAbs  = path.join(baseDir, outRel);
    const relHref = path.relative(baseDir, outAbs);

    const firstWord = fmt.name.split(/\s+/)[0];
    const stem      = `${lastName}_${firstWord}`;
    const pdfHref   = `pdf/${stem}.pdf`;
    const docxHref  = `docx/${stem}.docx`;

    return `
    <div class="card-row">
      <a class="resume-card" href="${escapeHtml(relHref)}">
        <span class="card-name">${escapeHtml(fmt.name)}</span>
        <span class="card-arrow">→</span>
      </a>
      <div class="card-exports">
        <a class="export-link" href="${escapeHtml(pdfHref)}" download title="Download PDF">
          ${FILE_ICON}<span class="export-label">PDF</span>
        </a>
        <a class="export-link" href="${escapeHtml(docxHref)}" download title="Download DOCX">
          ${FILE_ICON}<span class="export-label">DOC</span>
        </a>
      </div>
    </div>`;
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
      --bg: #ffffff; --ink-1: #1a1a1a; --ink-2: #444444;
      --ink-3: #555555; --ink-4: #999999; --rule-1: #cccccc; --rule-2: #e8e8e8;
    }
    [data-theme="dark"] {
      --bg: #161616; --ink-1: #e2e2e2; --ink-2: #b2b2b2;
      --ink-3: #909090; --ink-4: #5e5e5e; --rule-1: #383838; --rule-2: #2c2c2c;
    }

    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0; min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 3rem 2rem;
      background: var(--bg); color: var(--ink-1);
      font-family: 'DM Sans', sans-serif; font-weight: 300;
      transition: background 0.2s, color 0.2s;
    }

    .theme-toggle {
      position: fixed; top: 1rem; right: 1rem; display: flex; align-items: center;
      gap: 5px; background: var(--bg); border: 0.5px solid var(--rule-1);
      border-radius: 4px; color: var(--ink-4); cursor: pointer; padding: 5px 9px;
      font-size: 11px; font-family: 'DM Sans', sans-serif; font-weight: 300;
      letter-spacing: 0.04em; z-index: 100;
      transition: color 0.2s, border-color 0.2s, background 0.2s;
    }
    .theme-toggle:hover { color: var(--ink-2); border-color: var(--ink-4); }
    .theme-toggle svg   { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }

    .page { width: 100%; max-width: 480px; }

    .page-name {
      font-family: 'Cormorant Garamond', serif; font-size: 38px; font-weight: 400;
      letter-spacing: 0.02em; margin: 0 0 6px 0; line-height: 1.1;
    }

    .page-subtitle {
      font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--ink-4); margin: 0 0 2.5rem 0;
    }

    .cards { display: flex; flex-direction: column; gap: 0; border-top: 0.5px solid var(--rule-1); }

    .card-row { display: flex; align-items: center; border-bottom: 0.5px solid var(--rule-1); }

    .resume-card {
      flex: 1; display: flex; align-items: center; justify-content: space-between;
      padding: 1.1rem 0; text-decoration: none; color: var(--ink-1);
      transition: color 0.15s; min-width: 0;
    }
    .resume-card:hover { color: var(--ink-4); }

    .card-name { font-size: 14px; font-weight: 300; letter-spacing: 0.01em; }

    .card-arrow {
      font-size: 16px; color: var(--ink-4); transition: transform 0.15s, color 0.15s;
      flex-shrink: 0; margin-right: 1.25rem;
    }
    .resume-card:hover .card-arrow { transform: translateX(4px); color: var(--ink-2); }

    .card-exports { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }

    .export-link {
      display: flex; flex-direction: column; align-items: center; gap: 3px;
      color: var(--ink-4); text-decoration: none; border: none;
      transition: color 0.15s; padding: 0.4rem 0;
    }
    .export-link:hover { color: var(--ink-2); border: none; }
    .export-link svg   { width: 13px; height: 16px; flex-shrink: 0; }

    .export-label { font-size: 8px; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1; }

    @media (max-width: 480px) { body { padding: 2rem 1.25rem; } .page-name { font-size: 30px; } }
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
const projectRoot = path.join(__dirname, "..");

// Auto-detect the single .md CV file in src/ when no argument is given
function autoDetectCV(dir) {
  const candidates = fs.readdirSync(dir).filter(
    f => f.endsWith(".md") && f !== "resumeFormats.md"
  );
  return candidates.length === 1 ? path.join(dir, candidates[0]) : null;
}

const cvPath = args[0] ? path.resolve(args[0]) : autoDetectCV(scriptDir);

if (!cvPath) {
  console.error(
    "Usage: node src/md-to-resumes.js <source.md> [resumeFormats.md]\n" +
    "(Or place exactly one .md CV file in src/ to skip the argument.)"
  );
  process.exit(1);
}

const formatsPath = args[1]
  ? path.resolve(args[1])
  : path.join(scriptDir, "resumeFormats.md");

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

// ── 1. Parse CV to JSON ───────────────────────────────────────────────────────

const md      = fs.readFileSync(cvPath, "utf-8");
const cv      = parseCV(md);

const jsonOut = path.join(scriptDir, path.basename(cvPath).replace(/\.md$/i, ".json"));
fs.writeFileSync(jsonOut, JSON.stringify(cv, null, 2), "utf-8");
console.log(`JSON written → ${jsonOut}\n`);

// ── 2. Parse resume formats ───────────────────────────────────────────────────

const formats = parseResumeFormats(fs.readFileSync(formatsPath, "utf-8"));
console.log(`Generating ${formats.length} formatted resume(s):\n`);

// ── 3. Generate one HTML resume per format ────────────────────────────────────

for (const format of formats) {
  console.log(`── ${format.name}`);

  const filteredCV = buildFilteredCV(cv, format);
  const html       = buildHTMLFromJSON(filteredCV);

  const outRelPath = format.outputPath
    || `/${format.name.toLowerCase().replace(/\s+/g, "-")}/index.html`;
  const outAbsPath = path.join(projectRoot, outRelPath);

  fs.mkdirSync(path.dirname(outAbsPath), { recursive: true });
  fs.writeFileSync(outAbsPath, html, "utf-8");
  console.log(`   ✓  ${outAbsPath}\n`);
}

// ── 4. Root index ─────────────────────────────────────────────────────────────

const indexPath = path.join(projectRoot, "index.html");
fs.writeFileSync(indexPath, buildIndexHTML(cv, formats, projectRoot), "utf-8");
console.log(`── Index\n   ✓  ${indexPath}\n`);

// ── 5. PDF + DOCX exports ─────────────────────────────────────────────────────

const exports_ = spawnSync(
  process.execPath,
  [path.join(scriptDir, "html-to-exports.js"), formatsPath],
  { stdio: "inherit" }
);
if (exports_.status !== 0) {
  console.error("html-to-exports.js exited with an error.");
  process.exit(exports_.status ?? 1);
}

console.log("Done.\n");
