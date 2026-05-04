#!/usr/bin/env node
/**
 * html-to-exports.js
 * Converts each generated resume HTML file to PDF (→ /pdf) and DOCX (→ /docx)
 * using pandoc + xelatex.
 *
 * Usage:
 *   node html-to-exports.js [resumeFormats.md]
 *   Defaults to resumeFormats.md in the same directory.
 *
 * Requirements: pandoc and xelatex must be on PATH.
 */

"use strict";

const fs            = require("fs");
const os            = require("os");
const path          = require("path");
const { spawnSync } = require("child_process");

const scriptDir   = __dirname;
const args        = process.argv.slice(2);
const formatsPath = args[0]
  ? path.resolve(args[0])
  : path.join(scriptDir, "resumeFormats.md");

// ── Locate Chrome (for PDF generation) ───────────────────────────────────────
//
// We use Chrome / Chromium headless to print PDFs so the output looks exactly
// like the browser version — proper fonts, CSS layout, no TeX required.
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "google-chrome",
  "chromium",
  "chromium-browser",
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      const r = spawnSync("which", [candidate], { encoding: "utf-8" });
      if (r.status === 0 && r.stdout.trim()) return candidate;
    }
  }
  return null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.error(
    "Error: Chrome / Chromium not found.\n" +
    "Install Google Chrome (https://www.google.com/chrome/) and re-run.",
  );
  process.exit(1);
}

// ── Parse format output paths from resumeFormats.md ──────────────────────────
//
// Reads every top-level heading and extracts the (output to '…') annotation,
// giving us the relative path to each generated HTML file.

function parseOutputPaths(md) {
  const results = [];
  for (const line of md.split("\n")) {
    const trim = line.trim();
    if (!trim.startsWith("# ")) continue;
    const pathMatch = trim.match(/\(output to ['"]([^'"]+)['"]\)/);
    const nameMatch = trim.match(/^#\s+(.+?)(?:\s+\(output|$)/);
    if (pathMatch && nameMatch) {
      results.push({
        htmlRel:  pathMatch[1],                                       // e.g. "/artist/index.html"
        label:    nameMatch[1].replace(/\s*\(output to [^)]+\)/, "").trim(), // e.g. "Artist Resume"
      });
    }
  }
  return results;
}

// ── Lua filter path ───────────────────────────────────────────────────────────
//
// table-fix.lua intercepts every Table node in the pandoc AST and sets:
//   • AlignLeft on every column
//   • proportional relative widths (so the last column wraps instead of
//     bleeding off the page in PDF, and tables span full width in DOCX)
//
// Must be an absolute path so pandoc can find it regardless of the cwd it
// is invoked from.
const luaFilter = path.join(scriptDir, "table-fix.lua");

// ── Table preprocessing ───────────────────────────────────────────────────────
//
// Pandoc strips all CSS before converting.  The Lua filter (above) is the
// primary fix for column widths and alignment.  We also add plain HTML
// attributes here as a belt-and-suspenders measure for DOCX renderers that
// honour them directly.

/**
 * Rewrite every <table> to carry align="left" width="100%".
 * Column-width proportions are handled by the Lua filter instead.
 */
function fixTables(html) {
  return html.replace(/<table([^>]*)>/gi, (_, attrs) => {
    const cleanAttrs = attrs
      .replace(/\balign\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\bwidth\s*=\s*["'][^"']*["']/gi, "");
    return `<table${cleanAttrs} align="left" width="100%">`;
  });
}

// ── HTML preprocessing ────────────────────────────────────────────────────────
//
// Strips browser-only noise (style sheets, scripts, theme toggle), promotes
// our custom div-based section structure into semantic HTML headings so pandoc
// builds a properly hierarchical document, and fixes table attributes.

function preprocessHTML(html) {
  const cleaned = html
    // ── Strip browser-only blocks ──
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")

    // ── Strip SVG images ──
    // Inline <svg>…</svg> blocks and <img src="*.svg"> references are
    // decorative icons that pandoc cannot convert without rsvg-convert.
    // Remove them entirely so the document content comes through cleanly.
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<img[^>]*src="[^"]*\.svgz?"[^>]*>/gi, "")

    // ── Force light mode (white background) ──
    .replace(/data-theme="dark"/gi, 'data-theme="light"')

    // ── Promote custom div roles → semantic HTML elements ──
    // section-label divs  → <h2>  (section headings: Profile, Education …)
    .replace(
      /<div[^>]*class="section-label"[^>]*>([\s\S]*?)<\/div>/gi,
      "<h2>$1</h2>",
    )
    // sub-label divs → <h3>  (sub-section headings: Photography, Bibliography …)
    .replace(
      /<div[^>]*class="sub-label"[^>]*>([\s\S]*?)<\/div>/gi,
      "<h3>$1</h3>",
    )
    // section-divider empty divs → remove
    .replace(/<div[^>]*class="section-divider"[^>]*>\s*<\/div>/gi, "");

  // ── Add align/width HTML attributes on tables ──
  // (Lua filter handles the deep column-spec fix; this is supplementary.)
  return fixTables(cleaned);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the person's name from the HTML <title> tag. */
function extractName(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return "";
  return m[1].replace(/\s*[—–-].*$/, "").trim();   // "Andrew Atkinson — CV" → "Andrew Atkinson"
}

/**
 * Build the output file stem.
 * e.g.  name="Andrew Atkinson", label="Artist Resume"  →  "Atkinson_Artist"
 */
function buildStem(name, label) {
  const lastName  = name.split(/\s+/).pop() || "Resume";
  const firstWord = label.split(/\s+/)[0];           // "Artist" from "Artist Resume"
  return `${lastName}_${firstWord}`;
}

/**
 * Run pandoc, feeding it a temporary HTML file.
 * Returns the spawnSync result object.
 */
function runPandoc(pandocArgs, htmlContent) {
  // Write to a temp file — more reliable than piping complex HTML through stdin
  const tmpFile = path.join(os.tmpdir(), `resume-export-${process.pid}-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmpFile, htmlContent, "utf-8");
    return spawnSync("pandoc", [tmpFile, ...pandocArgs], {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore cleanup errors */ }
  }
}

// ── PDF preparation ───────────────────────────────────────────────────────────
//
// For Chrome we keep the full HTML (including CSS) so the PDF matches the
// browser exactly.  We only need to force light mode and inject A4 page
// geometry + print overrides.

function prepareHTMLForPDF(html) {
  const printStyles = [
    "@page { size: A4; margin: 2cm 2.5cm; }",
    "body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
  ].join(" ");

  return html
    // Force light mode regardless of system preference
    .replace(/data-theme="dark"/gi, 'data-theme="light"')
    // Inject print styles just before </head>
    .replace(/<\/head>/i, `<style>${printStyles}</style></head>`);
}

// ── PDF generation (Chrome headless) ─────────────────────────────────────────

function generatePDF(rawHTML, outPath) {
  const printHTML = prepareHTMLForPDF(rawHTML);
  const tmpFile = path.join(
    os.tmpdir(),
    `resume-pdf-${process.pid}-${Date.now()}.html`,
  );
  try {
    fs.writeFileSync(tmpFile, printHTML, "utf-8");
    return spawnSync(
      chromePath,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--run-all-compositor-stages-before-draw",
        "--print-to-pdf-no-header",
        `--print-to-pdf=${outPath}`,
        `file://${tmpFile}`,
      ],
      { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 },
    );
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

// ── DOCX generation ──────────────────────────────────────────────────────────

function generateDOCX(cleanHTML, outPath, title) {
  return runPandoc([
    "--from=html",
    "--to=docx",
    "--lua-filter", luaFilter,
    "--metadata", `title=${title}`,
    "--output", outPath,
  ], cleanHTML);
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!fs.existsSync(formatsPath)) {
  console.error(`Error: Formats file not found — ${formatsPath}`);
  process.exit(1);
}

const entries = parseOutputPaths(fs.readFileSync(formatsPath, "utf-8"));
if (entries.length === 0) {
  console.error("No resume output paths found in formats file.");
  process.exit(1);
}

// Create output directories
const pdfDir  = path.join(scriptDir, "pdf");
const docxDir = path.join(scriptDir, "docx");
fs.mkdirSync(pdfDir,  { recursive: true });
fs.mkdirSync(docxDir, { recursive: true });

console.log(`\nExporting ${entries.length} resume(s) to PDF + DOCX:\n`);

let allOk = true;

for (const { htmlRel, label } of entries) {
  const htmlAbs = path.join(scriptDir, htmlRel);

  if (!fs.existsSync(htmlAbs)) {
    console.warn(`  ⚠  HTML not found: ${htmlAbs} — skipping`);
    allOk = false;
    continue;
  }

  const rawHTML   = fs.readFileSync(htmlAbs, "utf-8");
  const cleanHTML = preprocessHTML(rawHTML);           // for DOCX
  const name      = extractName(rawHTML);
  const stem      = buildStem(name, label);           // e.g. "Atkinson_Artist"
  const title     = `${name} — ${label}`;             // DOCX metadata title

  console.log(`── ${label}  (${stem})`);

  // ── PDF (Chrome headless — renders full CSS) ──────────────────────────────
  const pdfPath = path.join(pdfDir, `${stem}.pdf`);
  const pdfRes  = generatePDF(rawHTML, pdfPath);
  // Chrome exits 0 even on partial errors; check the output file was written.
  if (pdfRes.status !== 0 || !fs.existsSync(pdfPath)) {
    console.error(`   ✗  PDF failed:\n${pdfRes.stderr || pdfRes.stdout}`);
    allOk = false;
  } else {
    console.log(`   ✓  ${pdfPath}`);
  }

  // ── DOCX ─────────────────────────────────────────────────────────────────
  const docxPath = path.join(docxDir, `${stem}.docx`);
  const docxRes  = generateDOCX(cleanHTML, docxPath, title);
  if (docxRes.status !== 0) {
    console.error(`   ✗  DOCX failed:\n${docxRes.stderr}`);
    allOk = false;
  } else {
    console.log(`   ✓  ${docxPath}`);
  }

  console.log();
}

console.log(allOk ? "Done.\n" : "Done (with errors).\n");
if (!allOk) process.exit(1);
