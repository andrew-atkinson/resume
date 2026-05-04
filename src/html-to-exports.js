#!/usr/bin/env node
/**
 * html-to-exports.js
 * Converts each generated resume HTML file to PDF (→ /pdf) and DOCX (→ /docx).
 *
 * PDF  — puppeteer-core driving the system Chrome install.
 *        displayHeaderFooter: false guarantees no date/URL overlays regardless
 *        of Chrome version.
 * DOCX — pandoc with a Lua filter for table column widths.
 *
 * Usage:
 *   node html-to-exports.js [resumeFormats.md]
 *   Defaults to resumeFormats.md in the same directory.
 *
 * Requirements: pandoc on PATH, Google Chrome installed, puppeteer-core
 *   (npm install puppeteer-core  — run once from the project root).
 */

"use strict";

const fs            = require("fs");
const os            = require("os");
const path          = require("path");
const { spawnSync } = require("child_process");
const puppeteer     = require("puppeteer-core");

const scriptDir   = __dirname;                    // …/resumes/src
const projectRoot = path.join(__dirname, "..");   // …/resumes  (GitHub Pages root)
const args        = process.argv.slice(2);
const formatsPath = args[0]
  ? path.resolve(args[0])
  : path.join(scriptDir, "resumeFormats.md");     // resumeFormats.md lives in src/

// ── Locate Chrome ─────────────────────────────────────────────────────────────
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

function parseOutputPaths(md) {
  const results = [];
  for (const line of md.split("\n")) {
    const trim = line.trim();
    if (!trim.startsWith("# ")) continue;
    const pathMatch = trim.match(/\(output to ['"]([^'"]+)['"]\)/);
    const nameMatch = trim.match(/^#\s+(.+?)(?:\s+\(output|$)/);
    if (pathMatch && nameMatch) {
      results.push({
        htmlRel: pathMatch[1],
        label:   nameMatch[1].replace(/\s*\(output to [^)]+\)/, "").trim(),
      });
    }
  }
  return results;
}

// ── Lua filter path ───────────────────────────────────────────────────────────
const luaFilter = path.join(scriptDir, "table-fix.lua");

// ── Table preprocessing ───────────────────────────────────────────────────────

function fixTables(html) {
  return html.replace(/<table([^>]*)>/gi, (_, attrs) => {
    const cleanAttrs = attrs
      .replace(/\balign\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\bwidth\s*=\s*["'][^"']*["']/gi, "");
    return `<table${cleanAttrs} align="left" width="100%">`;
  });
}

// ── HTML preprocessing (DOCX path) ───────────────────────────────────────────

function preprocessHTML(html) {
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<img[^>]*src="[^"]*\.svgz?"[^>]*>/gi, "")
    .replace(/data-theme="dark"/gi, 'data-theme="light"')
    .replace(
      /<div[^>]*class="section-label"[^>]*>([\s\S]*?)<\/div>/gi,
      "<h2>$1</h2>",
    )
    .replace(
      /<div[^>]*class="sub-label"[^>]*>([\s\S]*?)<\/div>/gi,
      "<h3>$1</h3>",
    )
    .replace(/<div[^>]*class="section-divider"[^>]*>\s*<\/div>/gi, "");

  return fixTables(cleaned);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractName(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return "";
  return m[1].replace(/\s*[—–-].*$/, "").trim();
}

function buildStem(name, label) {
  const lastName  = name.split(/\s+/).pop() || "Resume";
  const firstWord = label.split(/\s+/)[0];
  return `${lastName}_${firstWord}`;
}

function runPandoc(pandocArgs, htmlContent) {
  const tmpFile = path.join(os.tmpdir(), `resume-export-${process.pid}-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmpFile, htmlContent, "utf-8");
    return spawnSync("pandoc", [tmpFile, ...pandocArgs], {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

// ── PDF preparation ───────────────────────────────────────────────────────────
//
// Inject print-specific CSS.  Margins are passed directly to puppeteer's
// page.pdf() so @page rules here only need to set the page size.

function prepareHTMLForPDF(html) {
  const printStyles = [
    "@page { size: A4; }",
    "body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
    ".resume { max-width: 100% !important; }",
  ].join(" ");

  return html
    .replace(/data-theme="dark"/gi, 'data-theme="light"')
    .replace(/<\/head>/i, `<style>${printStyles}</style></head>`);
}

// ── PDF generation (puppeteer-core) ──────────────────────────────────────────
//
// puppeteer exposes the CDP Page.printToPDF call directly, which accepts
// displayHeaderFooter: false — guaranteed to suppress Chrome's date/URL
// overlays regardless of Chrome version or headless mode.

async function generatePDF(rawHTML, outPath) {
  const printHTML = prepareHTMLForPDF(rawHTML);
  const tmpFile = path.join(os.tmpdir(), `resume-pdf-${process.pid}-${Date.now()}.html`);

  try {
    fs.writeFileSync(tmpFile, printHTML, "utf-8");

    const browser = await puppeteer.launch({
      executablePath: chromePath,
      args: ["--no-sandbox", "--disable-gpu"],
    });

    try {
      const page = await browser.newPage();
      await page.goto(`file://${tmpFile}`, { waitUntil: "networkidle0" });
      await page.pdf({
        path:                 outPath,
        format:               "A4",
        displayHeaderFooter:  false,   // no date / URL / page-number overlays
        printBackground:      true,    // preserve background colours
        margin: {
          top:    "0.75in",
          right:  "2.5cm",
          bottom: "1in",
          left:   "2.5cm",
        },
      });
    } finally {
      await browser.close();
    }
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

const pdfDir  = path.join(projectRoot, "pdf");
const docxDir = path.join(projectRoot, "docx");
fs.mkdirSync(pdfDir,  { recursive: true });
fs.mkdirSync(docxDir, { recursive: true });

console.log(`\nExporting ${entries.length} resume(s) to PDF + DOCX:\n`);

(async () => {
  let allOk = true;

  for (const { htmlRel, label } of entries) {
    const htmlAbs = path.join(projectRoot, htmlRel);

    if (!fs.existsSync(htmlAbs)) {
      console.warn(`  ⚠  HTML not found: ${htmlAbs} — skipping`);
      allOk = false;
      continue;
    }

    const rawHTML   = fs.readFileSync(htmlAbs, "utf-8");
    const cleanHTML = preprocessHTML(rawHTML);
    const name      = extractName(rawHTML);
    const stem      = buildStem(name, label);
    const title     = `${name} — ${label}`;

    console.log(`── ${label}  (${stem})`);

    // ── PDF ────────────────────────────────────────────────────────────────
    const pdfPath = path.join(pdfDir, `${stem}.pdf`);
    try {
      await generatePDF(rawHTML, pdfPath);
      if (!fs.existsSync(pdfPath)) throw new Error("PDF file was not created");
      console.log(`   ✓  ${pdfPath}`);
    } catch (err) {
      console.error(`   ✗  PDF failed: ${err.message}`);
      allOk = false;
    }

    // ── DOCX ───────────────────────────────────────────────────────────────
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
})();
