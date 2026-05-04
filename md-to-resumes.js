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

// ── Main ──────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const scriptDir   = __dirname;

const cvPath      = args[0] ? path.resolve(args[0]) : path.join(scriptDir, "Atkinson_CV.md");
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

const cv      = parseMarkdown(fs.readFileSync(cvPath, "utf-8"));
const formats = parseResumeFormats(fs.readFileSync(formatsPath, "utf-8"));

console.log(`Generating ${formats.length} resume(s):\n`);

for (const format of formats) {
  console.log(`── ${format.name}`);

  const filteredCV = buildFilteredCV(cv, format);
  const html       = buildHTML(filteredCV);

  // Resolve output path relative to the script directory
  const outRelPath = format.outputPath
    || `/${format.name.toLowerCase().replace(/\s+/g, "-")}/index.html`;
  const outAbsPath = path.join(scriptDir, outRelPath);
  const outDir     = path.dirname(outAbsPath);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outAbsPath, html, "utf-8");
  console.log(`   ✓  ${outAbsPath}\n`);
}

console.log("Done.\n");
