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
//
// Forces every <table> to 100% width so the Lua filter's proportional column
// specs span the full text column.  style="width:100%" and width="100%" both
// specified so pandoc honours it regardless of which attribute it reads.

function fixTables(html) {
  // Strip any pixel-based width or style from table cells and col elements
  // so the Lua filter's proportional widths are the only sizing in play.
  const stripCellWidths = (s) => s
    .replace(/(<(?:th|td|col|colgroup)[^>]*?)\s+style="[^"]*"([^>]*?>)/gi, "$1$2")
    .replace(/(<(?:th|td|col|colgroup)[^>]*?)\s+width="[^"]*"([^>]*?>)/gi, "$1$2");

  return stripCellWidths(html).replace(/<table([^>]*)>/gi, (_, attrs) => {
    const clean = attrs
      .replace(/\balign\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\bwidth\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\bstyle\s*=\s*["'][^"']*["']/gi, "");
    return `<table${clean} align="left" width="100%" style="width:100%">`;
  });
}

// ── Contact restructuring (DOCX only) ────────────────────────────────────────
//
// In HTML the contact row is a flex div — all items inline.  For DOCX we put
// each item on its own paragraph with an inferred label ("Email:", "Tel:", …).

function contactLinesForDocx(html) {
  return html.replace(
    /<div[^>]*class="resume-contact"[^>]*>([\s\S]*?)<\/div>/gi,
    (_, inner) => {
      const lines = [];
      const re = /<(a|span)([^>]*)>([\s\S]*?)<\/\1>/gi;
      let m;
      while ((m = re.exec(inner)) !== null) {
        const tag     = m[1];
        const attrs   = m[2];
        const content = m[3].trim();
        if (!content) continue;

        // Derive a label from the href type
        const hrefM = attrs.match(/href="([^"]*)"/i);
        let label = "";
        if (hrefM) {
          const href = hrefM[1];
          if (href.startsWith("mailto:"))       label = "Email";
          else if (href.startsWith("tel:"))     label = "Tel";
          else if (href.includes("linkedin"))   label = "LinkedIn";
          else                                  label = "Web";
        }
        const prefix = label ? `${label}: ` : "";
        lines.push(`<p>${prefix}<${tag}${attrs}>${content}</${tag}></p>`);
      }
      return lines.join("\n");
    },
  );
}

// ── HTML preprocessing (DOCX path) ───────────────────────────────────────────
//
// Strips browser-only noise, restructures the contact block, promotes div-based
// section structure into semantic HTML headings, applies DOCX-friendly colour
// hints for dated list items and entry subtitles, and fixes table attributes.

function preprocessHTML(html) {
  const cleaned = html
    // ── Strip browser-only blocks ──
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")

    // ── Strip decorative SVGs ──
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<img[^>]*src="[^"]*\.svgz?"[^>]*>/gi, "")

    // ── Force light mode ──
    .replace(/data-theme="dark"/gi, 'data-theme="light"')

    // ── Issue 6: year prefix in list items → warm grey in DOCX ──
    // pandoc honours inline style="color:…" and maps it to OOXML w:color.
    .replace(
      /<span[^>]*class="item-date"[^>]*>([\s\S]*?)<\/span>/gi,
      '<span style="color: #999999">$1</span>',
    )

    // ── Entry date → <em> with muted colour (must run before entry-subtitle) ──
    .replace(
      /<span[^>]*class="entry-date"[^>]*>([\s\S]*?)<\/span>/gi,
      '<em style="color: #999999">$1</em>',
    )

    // ── Table header cells → warm mid-tone ──
    // pandoc converts inline style="color:…" on <span> to w:color in OOXML.
    // The span is inside the <td> content, so fixTables won't strip it.
    // IMPORTANT: use (?!ead) to avoid matching <thead> (which also starts with <th).
    // #7a6a5a = warm taupe mid-tone (readable against white, warm not grey).
    .replace(
      /<th(?!ead)([^>]*)>([\s\S]*?)<\/th>/gi,
      '<th$1><span style="color: #7a6a5a; font-size: 9pt">$2</span></th>',
    )

    // ── Promote custom div roles → semantic HTML headings ──
    .replace(
      /<div[^>]*class="section-label"[^>]*>([\s\S]*?)<\/div>/gi,
      "<h2>$1</h2>",
    )
    .replace(
      /<div[^>]*class="sub-label"[^>]*>([\s\S]*?)<\/div>/gi,
      "<h3>$1</h3>",
    )
    .replace(/<div[^>]*class="section-divider"[^>]*>\s*<\/div>/gi, "");

  // ── Entry subtitles → <strong> org text (+ muted <em> date where present) ──
  //
  // Two distinct subtitle structures exist in the HTML:
  //
  //   (A) Service / committee sections use div elements:
  //       <div class="entry-subtitle">TEXT</div>
  //       → <p><strong>TEXT</strong></p>
  //
  //   (B) Dated experience entries use a span inside a paragraph:
  //       <p class="entry-desc"><span class='entry-subtitle'>ORG</span> — <em>DATE</em></p>
  //       → <p><strong>ORG</strong> — <em style="color:#999999">DATE</em></p>
  //
  // Run A first so B doesn't see leftover div content.

  // (A) div-based subtitles — University Service, Professional Service, etc.
  const withDivSubtitles = cleaned.replace(
    /<div[^>]*class="entry-subtitle"[^>]*>([\s\S]*?)<\/div>/gi,
    (_, content) => {
      const dateEl = content.match(/<em[^>]*>[\s\S]*?<\/em>/i);
      if (dateEl) {
        const orgText = content.replace(/<em[^>]*>[\s\S]*?<\/em>/i, "").trim();
        return `<p><strong>${orgText}</strong> ${dateEl[0]}</p>`;
      }
      return `<p><strong>${content.trim()}</strong></p>`;
    },
  );

  // Also promote div-based entry-desc to plain <p> so pandoc treats them as paragraphs
  const withDivDescs = withDivSubtitles.replace(
    /<div[^>]*class="entry-desc[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    "<p>$1</p>",
  );

  // (B) p/span-based subtitles — Professional Experience, etc.
  const withSubtitles = withDivDescs.replace(
    /<p[^>]*class="entry-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/gi,
    (_, content) => {
      const subtitleMatch = content.match(
        /<span[^>]*class=['"]entry-subtitle['"][^>]*>([\s\S]*?)<\/span>/i,
      );
      if (!subtitleMatch) return `<p>${content}</p>`;

      const orgText = subtitleMatch[1].trim();
      // Everything after the subtitle span (typically " — <em>date</em>")
      const after   = content
        .slice(content.indexOf(subtitleMatch[0]) + subtitleMatch[0].length)
        .trim()
        // Mute any bare <em> (dates written as *…* in Markdown) that follow
        .replace(/<em(?![^>]*style)[^>]*>/gi, '<em style="color: #999999">');

      return `<p><strong>${orgText}</strong> ${after}</p>`;
    },
  );

  // ── Contact div → one paragraph per item ──
  const withContact = contactLinesForDocx(withSubtitles);

  // ── Issue 5: table width ──
  return fixTables(withContact);
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

// ── Reference doc ─────────────────────────────────────────────────────────────
//
// reference.docx is generated once by make-reference-doc.py and controls all
// DOCX typography — fonts, colours, spacing, bullet style, no page-break-before
// on headings.  We regenerate it automatically if it is missing.

const referenceDoc    = path.join(scriptDir, "reference.docx");
const makeReferenceScript = path.join(scriptDir, "make-reference-doc.py");

function ensureReferenceDoc() {
  // Always regenerate — ensures style changes in make-reference-doc.py are
  // applied on every build without needing to manually delete reference.docx.
  console.log("  Generating reference.docx …");
  const r = spawnSync("python3", [makeReferenceScript], { encoding: "utf-8" });
  if (r.status !== 0) {
    console.error("  ✗  make-reference-doc.py failed:\n" + (r.stderr || r.stdout));
    process.exit(1);
  }
  console.log("  " + r.stdout.trim());
}

// ── DOCX generation ──────────────────────────────────────────────────────────

const fixTableHeadersScript = path.join(scriptDir, "fix-table-headers.py");

function generateDOCX(cleanHTML, outPath) {
  ensureReferenceDoc();

  const res = runPandoc([
    "--from=html",
    "--to=docx",
    "--lua-filter",    luaFilter,
    "--reference-doc", referenceDoc,
    "--output",        outPath,
  ], cleanHTML);

  if (res.status !== 0) return res;

  // Post-process: add bottom border to table header rows.
  // pandoc does not translate CSS borders, so we inject the OOXML directly.
  const fix = spawnSync("python3", [fixTableHeadersScript, outPath], { encoding: "utf-8" });
  if (fix.status !== 0) {
    console.warn("  ⚠  fix-table-headers.py failed:\n" + (fix.stderr || fix.stdout));
  }

  return res;
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
    const docxRes  = generateDOCX(cleanHTML, docxPath);
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
