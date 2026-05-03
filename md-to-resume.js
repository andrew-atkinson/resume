#!/usr/bin/env node
/**
 * md-to-resume.js
 * Converts a Markdown CV file to a styled HTML resume.
 *
 * Usage:
 *   node md-to-resume.js input.md              → writes input.html
 *   node md-to-resume.js input.md output.html  → writes output.html
 *
 * No dependencies — pure Node.js.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Inline markdown renderer ──────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text) {
  // Protect bare URLs (not already inside a markdown link) from further processing
  const urlPlaceholders = [];
  text = text.replace(/(?<!\()(https?:\/\/[^\s)]+)/g, (url) => {
    const i = urlPlaceholders.length;
    urlPlaceholders.push(url);
    return `\x00URL${i}\x00`;
  });

  // [label](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
  // ***bold italic***
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  // **bold**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // *italic* (asterisk only — avoid mangling underscores in URLs/identifiers)
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // Restore protected URLs
  text = text.replace(/\x00URL(\d+)\x00/g, (_, i) => escapeHtml(urlPlaceholders[i]));

  return text;
}

// ── Markdown parser ───────────────────────────────────────────────────────────

function parseMarkdown(md) {
  const lines = md.split('\n');
  const cv = { name: '', contact: [], bio: [], sections: [] };
  let i = 0;

  // H1 → name
  while (i < lines.length && !lines[i].startsWith('# ')) i++;
  if (i < lines.length) {
    cv.name = lines[i].replace(/^#\s+/, '').trim();
    i++;
  }

  // Contact lines + bio paragraphs (until first ## or ---)
  while (i < lines.length) {
    const line  = lines[i];
    const trim  = line.trim();
    if (trim.startsWith('## ') || trim === '---') break;

    const contactMatch = trim.match(/^(Email|Tel|LinkedIn|Phone|Web|Website):\s*(.+)/i);
    if (contactMatch) {
      cv.contact.push(contactMatch[2].trim());
    } else if (trim.length > 0 && !trim.startsWith('#')) {
      cv.bio.push(trim);
    }
    i++;
  }

  // Skip dividers
  while (i < lines.length && lines[i].trim() === '---') i++;

  // ## Sections
  while (i < lines.length) {
    const trim = lines[i].trim();
    if (trim.startsWith('## ')) {
      const sectionName  = trim.replace(/^##\s+/, '');
      const contentLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('## ')) {
        contentLines.push(lines[i]);
        i++;
      }
      cv.sections.push({ name: sectionName, content: contentLines });
    } else {
      i++;
    }
  }

  return cv;
}

// ── Section content renderer ──────────────────────────────────────────────────

function renderTable(tableLines) {
  const rows = tableLines
    .filter(l => l.trim().startsWith('|'))
    .map(l => l.trim().split('|').slice(1, -1).map(c => c.trim()));

  if (rows.length < 2) return '';

  const headers = rows[0];
  const body    = rows.slice(2); // skip separator row

  let html = '<table class="cv-table"><thead><tr>';
  html += headers.map(h => `<th>${renderInline(h)}</th>`).join('');
  html += '</tr></thead><tbody>';
  body.forEach(row => {
    html += '<tr>' + row.map(cell => `<td>${renderInline(cell)}</td>`).join('') + '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderSectionContent(lines) {
  let html = '';
  let i    = 0;

  while (i < lines.length) {
    const line  = lines[i];
    const trim  = line.trim();

    if (trim === '' || trim === '---') { i++; continue; }

    // ### Sub-heading
    if (trim.startsWith('### ')) {
      html += `<div class="sub-label">${escapeHtml(trim.replace(/^###\s+/, ''))}</div>`;
      i++;
      continue;
    }

    // Table block
    if (trim.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
      html += renderTable(block);
      continue;
    }

    // Entry: **Title** — *date* (professional experience style)
    const entryMatch = trim.match(/^\*\*(.+?)\*\*\s*[—–-]+\s*\*(.*?)\*/);
    if (entryMatch) {
      html += `<div class="entry">`;
      html += `<div class="entry-header">`;
      html += `<span class="entry-title">${renderInline(entryMatch[1])}</span>`;
      html += `<span class="entry-date">${renderInline(entryMatch[2])}</span>`;
      html += `</div>`;
      i++;
      // Indented bullets under the entry
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        const bullet = lines[i].trim().replace(/^-\s+/, '');
        html += `<div class="entry-desc">${renderInline(bullet)}</div>`;
        i++;
      }
      html += `</div>`;
      continue;
    }

    // Bullet list
    if (trim.startsWith('- ')) {
      html += '<ul class="cv-list">';
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        const item = lines[i].trim().replace(/^-\s+/, '');
        html += `<li>${renderInline(item)}</li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }

    // Bold-only line → sub-entry heading (e.g. **Curriculum Committee**)
    const boldHeading = trim.match(/^\*\*(.+?)\*\*$/);
    if (boldHeading) {
      html += `<div class="entry-subtitle">${escapeHtml(boldHeading[1])}</div>`;
      i++;
      // Collect following prose lines
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !lines[i].trim().startsWith('**') &&
        !lines[i].trim().startsWith('-')  &&
        !lines[i].trim().startsWith('|')  &&
        !lines[i].trim().startsWith('#')
      ) {
        html += `<div class="entry-desc">${renderInline(lines[i].trim())}</div>`;
        i++;
      }
      continue;
    }

    // Plain paragraph
    html += `<p class="entry-desc">${renderInline(trim)}</p>`;
    i++;
  }

  return html;
}

// ── Contact item renderer ─────────────────────────────────────────────────────

const LINKEDIN_LOGO = `<svg class="contact-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
</svg>`;

function renderContactItem(raw) {
  // Markdown link [label](url)
  const linkMatch = raw.match(/^\[(.+?)\]\((.+?)\)$/);
  if (linkMatch) {
    const label = escapeHtml(linkMatch[1]);
    const url   = escapeHtml(linkMatch[2]);
    const icon  = linkMatch[2].includes('linkedin.com') ? LINKEDIN_LOGO : '';
    return `<a href="${url}">${icon}${label}</a>`;
  }
  // Plain text
  return `<span>${escapeHtml(raw)}</span>`;
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHTML(cv) {
  const contactHTML = cv.contact.map(renderContactItem).join('\n      ');

  const bioHTML = cv.bio
    .filter(l => l.trim().length > 0)
    .map(l => `<p class="summary">${renderInline(l)}</p>`)
    .join('\n        ');

  const profileSection = cv.bio.filter(l => l.trim()).length > 0 ? `
    <div class="section">
      <div class="section-divider"></div>
      <div class="section-label">Profile</div>
      <div class="section-content">
        ${bioHTML}
      </div>
    </div>` : '';

  const sectionsHTML = cv.sections.map(s => `
    <div class="section">
      <div class="section-divider"></div>
      <div class="section-label">${escapeHtml(s.name)}</div>
      <div class="section-content">
        ${renderSectionContent(s.content)}
      </div>
    </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(cv.name)} — CV</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@300;400&display=swap');

    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 2.5rem;
      background: #fff;
      color: #1a1a1a;
    }

    .resume {
      font-family: 'DM Sans', sans-serif;
      font-weight: 300;
      font-size: 13px;
      color: #1a1a1a;
      max-width: 740px;
      margin: 0 auto;
      padding: 2rem 0;
      line-height: 1.6;
    }

    /* ── Header ── */
    .resume-header {
      padding-bottom: 1.25rem;
      margin-bottom: 0.75rem;
    }

    .resume-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 36px;
      font-weight: 400;
      letter-spacing: 0.02em;
      margin: 0 0 10px 0;
    }

    .resume-contact {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      font-size: 12px;
      color: #555;
    }

    .resume-contact a,
    .resume-contact span {
      color: #555;
      text-decoration: none;
      border-bottom: 0.5px solid #ccc;
    }

    /* ── Body grid ── */
    .resume-body {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 0;
    }

    .section { display: contents; }

    .section-divider {
      grid-column: 1 / -1;
      border-top: 0.5px solid #ccc;
    }

    .section-label {
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #999;
      padding: 1.25rem 1rem 0 0;
      line-height: 1.4;
    }

    .section-content {
      padding: 1.25rem 0;
    }

    /* ── Profile ── */
    .summary {
      font-size: 13px;
      color: #444;
      line-height: 1.7;
      max-width: 500px;
      margin: 0 0 0.75rem 0;
    }

    /* ── Entries ── */
    .entry { margin-bottom: 1.1rem; }
    .entry:last-child { margin-bottom: 0; }

    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }

    .entry-title {
      font-weight: 400;
      color: #1a1a1a;
      font-size: 13px;
    }

    .entry-date {
      font-size: 11px;
      color: #999;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .entry-org {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-size: 13px;
      color: #555;
      margin-bottom: 3px;
    }

    .entry-desc {
      font-size: 12px;
      color: #555;
      line-height: 1.6;
      margin: 3px 0 0 0;
    }

    .entry-subtitle {
      font-weight: 400;
      font-size: 13px;
      color: #1a1a1a;
      margin: 0.9rem 0 2px 0;
    }

    /* ── Sub-labels (### headings) ── */
    .sub-label {
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #999;
      margin: 1rem 0 0.4rem 0;
    }

    /* ── Lists ── */
    .cv-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .cv-list li {
      font-size: 12px;
      color: #555;
      line-height: 1.75;
      padding-left: 1rem;
      position: relative;
    }

    .cv-list li::before {
      content: '–';
      position: absolute;
      left: 0;
      color: #bbb;
    }

    /* ── Tables ── */
    .cv-table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
      margin-bottom: 0.5rem;
    }

    .cv-table th {
      text-align: left;
      font-weight: 400;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #999;
      padding: 0 14px 6px 0;
      border-bottom: 0.5px solid #e8e8e8;
    }

    .cv-table td {
      padding: 5px 14px 5px 0;
      color: #444;
      vertical-align: top;
      border-bottom: 0.5px solid #f2f2f2;
    }

    .cv-table td:first-child {
      color: #999;
      white-space: nowrap;
      font-size: 11px;
    }

    /* ── Links ── */
    a {
      color: inherit;
      text-decoration: none;
      border-bottom: 0.5px solid #ccc;
    }

    a:hover { border-bottom-color: #888; }

    /* ── Contact icons ── */
    .contact-icon {
      display: inline-block;
      width: 11px;
      height: 11px;
      fill: currentColor;
      vertical-align: middle;
      margin-right: 4px;
      position: relative;
      top: -1px;
    }

    /* ── Mobile ── */
    @media (max-width: 600px) {
      body { padding: 1.25rem; }

      .resume { padding: 1rem 0; }

      .resume-name { font-size: 28px; }

      .resume-contact { gap: 12px; }

      .resume-body {
        grid-template-columns: 1fr;
      }

      .section-divider {
        grid-column: 1;
        margin-top: 0.25rem;
      }

      .section-label {
        padding: 0.75rem 0 0.2rem 0;
        border: none;
      }

      .section-content {
        padding: 0.25rem 0 0.75rem 0;
      }

      .entry-header {
        flex-wrap: wrap;
        gap: 2px;
      }

      .entry-date {
        width: 100%;
        order: -1;
        font-size: 10px;
      }

      .cv-table { font-size: 11px; }
      .cv-table th, .cv-table td { padding-right: 8px; }
    }

    /* ── Print ── */
    @media print {
      body { padding: 0; }
      .resume { max-width: 100%; }
    }
  </style>
</head>
<body>
<div class="resume">

  <div class="resume-header">
    <h1 class="resume-name">${escapeHtml(cv.name)}</h1>
    <div class="resume-contact">
      ${contactHTML}
    </div>
  </div>

  <div class="resume-body">
    ${profileSection}
    ${sectionsHTML}
  </div>

</div>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node md-to-resume.js <input.md> [output.html]');
  process.exit(1);
}

const inputPath  = path.resolve(args[0]);
const outputPath = args[1]
  ? path.resolve(args[1])
  : inputPath.replace(/\.md$/i, '.html');

if (!fs.existsSync(inputPath)) {
  console.error(`Error: file not found — ${inputPath}`);
  process.exit(1);
}

const markdown = fs.readFileSync(inputPath, 'utf-8');
const cv       = parseMarkdown(markdown);
const html     = buildHTML(cv);

fs.writeFileSync(outputPath, html, 'utf-8');
console.log(`✓  ${path.basename(outputPath)}`);
