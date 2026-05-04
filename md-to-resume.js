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

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Inline markdown renderer ──────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// SVG icon appended after external links
const EXT_ICON = `<svg class="ext-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 9V1h4v1H2v7h7V5h1v4H1z"/><path d="M9 1H6l1.1 1.1L4 5.2l.8.8 3.1-3.1L9 4V1z"/></svg>`;

// Returns target/rel attrs + icon for http(s) URLs; empty string for mailto/tel
function externalAttrs(url) {
  return /^https?:\/\//i.test(url)
    ? { attrs: ' target="_blank" rel="noopener external"', icon: EXT_ICON }
    : { attrs: "", icon: "" };
}

function renderInline(text) {
  const urls = []; // \x00Un\x00
  const links = []; // \x01Ln\x01

  // 1. Stash ALL https?:// URLs so underscores inside them are never touched
  text = text.replace(/(https?:\/\/[^\s)]+)/g, (url) => {
    urls.push(url);
    return `\x00U${urls.length - 1}\x00`;
  });

  // 2. Stash whole markdown links [label](url-or-stash) so the label and href
  //    are both shielded while italic/bold rules run in step 3
  text = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, label, ref) => {
    links.push({ label, ref });
    return `\x01L${links.length - 1}\x01`;
  });

  // 3. Bold / italic on plain text only — no URLs or links present any more
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(
    /\*\*([^*]+)\*\*/g,
    "<span class='entry-subtitle'>$1</span>",
  );
  text = text.replace(/\*([^*\n]+)\*/g, "<em>--$1</em>");
  text = text.replace(/_([^_\n]+)_/g, "<em>$1</em>");

  // 4. Restore markdown links — apply italic to label, resolve URL stash
  text = text.replace(/\x01L(\d+)\x01/g, (_, i) => {
    const { label, ref } = links[parseInt(i)];

    // Resolve URL stash reference inside parens if present
    const uMatch = ref.match(/^\x00U(\d+)\x00$/);
    const url = uMatch ? urls[parseInt(uMatch[1])] : ref;
    if (uMatch) urls[parseInt(uMatch[1])] = null; // mark consumed

    // Apply italic/bold to label text
    let l = escapeHtml(label);
    l = l.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    l = l.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    l = l.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    l = l.replace(/_([^_\n]+)_/g, "<em>$1</em>");

    const { attrs, icon } = externalAttrs(url);
    return `<a href="${escapeHtml(url)}"${attrs}>${l}${icon}</a>`;
  });

  // 5. Restore remaining URL stashes (bare URLs not consumed by a markdown link)
  text = text.replace(/\x00U(\d+)\x00/g, (_, i) => {
    const url = urls[parseInt(i)];
    if (!url) return "";
    const { attrs, icon } = externalAttrs(url);
    return `<a href="${escapeHtml(url)}"${attrs}>${escapeHtml(url)}${icon}</a>`;
  });

  return text;
}

// ── Markdown parser ───────────────────────────────────────────────────────────

function parseMarkdown(md) {
  const lines = md.split("\n");
  const cv = { name: "", contact: [], bio: [], sections: [] };
  let i = 0;

  // H1 → name
  while (i < lines.length && !lines[i].startsWith("# ")) i++;
  if (i < lines.length) {
    cv.name = lines[i].replace(/^#\s+/, "").trim();
    i++;
  }

  // Contact lines + bio paragraphs (until first ## or ---)
  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();
    if (trim.startsWith("## ") || trim === "---") break;

    const contactMatch = trim.match(
      /^(Email|Tel|LinkedIn|Phone|Web|Website):\s*(.+)/i,
    );
    if (contactMatch) {
      cv.contact.push(contactMatch[2].trim());
    } else if (trim.length > 0 && !trim.startsWith("#")) {
      cv.bio.push(trim);
    }
    i++;
  }

  // Skip dividers
  while (i < lines.length && lines[i].trim() === "---") i++;

  // ## Sections
  while (i < lines.length) {
    const trim = lines[i].trim();
    if (trim.startsWith("## ")) {
      const sectionName = trim.replace(/^##\s+/, "");
      const contentLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("## ")) {
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
    .filter((l) => l.trim().startsWith("|"))
    .map((l) =>
      l
        .trim()
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );

  if (rows.length < 2) return "";

  const headers = rows[0];
  const body = rows.slice(2); // skip separator row

  let html = '<table class="cv-table"><thead><tr>';
  html += headers.map((h) => `<th>${renderInline(h)}</th>`).join("");
  html += "</tr></thead><tbody>";
  body.forEach((row) => {
    html +=
      "<tr>" +
      row.map((cell) => `<td>${renderInline(cell)}</td>`).join("") +
      "</tr>";
  });
  html += "</tbody></table>";
  return html;
}

function renderSectionContent(lines) {
  let html = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();

    if (trim === "" || trim === "---") {
      i++;
      continue;
    }

    // ### Sub-heading
    if (trim.startsWith("### ")) {
      html += `<div class="sub-label">${escapeHtml(trim.replace(/^###\s+/, ""))}</div>`;
      i++;
      continue;
    }

    // Table block
    if (trim.startsWith("|")) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith("|"))
        block.push(lines[i++]);
      html += renderTable(block);
      continue;
    }

    // Entry: **Title** — *date* (professional experience style)
    const entryMatch = trim.match(/^\*\*(.+?)\*\*\s*[—–-]+\s*\*(.*?)\*/);
    if (entryMatch) {
      html += `<div class="entry-subtitle">${renderInline(entryMatch[1])} <span class="entry-date">${renderInline(entryMatch[2])}</span></div>`;
      i++;
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        const bullet = lines[i].trim().replace(/^-\s+/, "");
        html += `<div class="entry-desc">${renderInline(bullet)}</div>`;
        i++;
      }
      continue;
    }

    // Bullet list
    if (trim.startsWith("- ")) {
      html += `<ul class="cv-list">`;
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        const item = lines[i].trim().replace(/^-\s+/, "");
        // Wrap leading year (e.g. "2022 —" or "2022–23 —") in .item-date span
        const dated = item.replace(
          /^(\d{4}(?:[–\-]\d{2,4})?)\s*(—|–|-)\s*/,
          (_, yr, dash) => `<span class="item-date">${yr} ${dash}</span> `,
        );
        html += `<li>${renderInline(dated)}</li>`;
        i++;
      }
      html += "</ul>";
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
        lines[i].trim() !== "" &&
        !lines[i].trim().startsWith("**") &&
        !lines[i].trim().startsWith("-") &&
        !lines[i].trim().startsWith("|") &&
        !lines[i].trim().startsWith("#")
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
    const url = escapeHtml(linkMatch[2]);
    const liIcon = linkMatch[2].includes("linkedin.com") ? LINKEDIN_LOGO : "";
    const { attrs, icon } = externalAttrs(linkMatch[2]);
    return `<a href="${url}"${attrs}>${liIcon}${label}${icon}</a>`;
  }
  // Plain text
  return `<span>${escapeHtml(raw)}</span>`;
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildHTML(cv) {
  const contactHTML = cv.contact.map(renderContactItem).join("\n      ");

  const bioHTML = cv.bio
    .filter((l) => l.trim().length > 0)
    .map((l) => `<p class="summary">${renderInline(l)}</p>`)
    .join("\n        ");

  const profileSection =
    cv.bio.filter((l) => l.trim()).length > 0
      ? `
    <div class="section">
      <div class="section-divider"></div>
      <div class="section-label">Profile</div>
      <div class="section-content">
        ${bioHTML}
      </div>
    </div>`
      : "";

  const sectionsHTML = cv.sections
    .map(
      (s) => `
    <div class="section">
      <div class="section-divider"></div>
      <div class="section-label">${escapeHtml(s.name)}</div>
      <div class="section-content">
        ${renderSectionContent(s.content)}
      </div>
    </div>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(cv.name)} — CV</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@300;400&display=swap');

    /* ── Colour tokens ── */
    :root {
      --bg:     #ffffff;
      --ink-1:  #1a1a1a;
      --ink-2:  #444444;
      --ink-3:  #555555;
      --ink-4:  #999999;
      --rule-1: #cccccc;
      --rule-2: #e8e8e8;
      --rule-3: #f2f2f2;
    }

    [data-theme="dark"] {
      --bg:     #161616;
      --ink-1:  #e2e2e2;
      --ink-2:  #b2b2b2;
      --ink-3:  #909090;
      --ink-4:  #5e5e5e;
      --rule-1: #383838;
      --rule-2: #2c2c2c;
      --rule-3: #242424;
    }

    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 2.5rem;
      background: var(--bg);
      color: var(--ink-1);
      transition: background 0.2s, color 0.2s;
    }

    .resume {
      font-family: 'DM Sans', sans-serif;
      font-weight: 300;
      font-size: 13px;
      color: var(--ink-1);
      max-width: 740px;
      margin: 0 auto;
      padding: 2rem 0;
      line-height: 1.6;
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
    .theme-toggle:hover {
      color: var(--ink-2);
      border-color: var(--ink-4);
    }
    .theme-toggle svg {
      width: 12px;
      height: 12px;
      fill: currentColor;
      flex-shrink: 0;
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
      color: var(--ink-3);
    }

    .resume-contact a,
    .resume-contact span {
      color: var(--ink-3);
      text-decoration: none;
      border-bottom: 0.5px solid var(--rule-1);
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
      border-top: 0.5px solid var(--rule-1);
    }

    .section-label {
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink-4);
      padding: 1.25rem 1rem 0 0;
      line-height: 1.4;
    }

    .section-content {
      padding: 1.25rem 0;
    }

    /* ── Profile ── */
    .summary {
      font-size: 13px;
      color: var(--ink-2);
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
      color: var(--ink-1);
      font-size: 13px;
    }

    .entry-title--org {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-size: 15px;
      font-weight: 500;
      color: var(--ink-1);
    }

    .entry-date {
      font-size: 11px;
      color: var(--ink-4);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .entry-org {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-size: 13px;
      color: var(--ink-3);
      margin-bottom: 3px;
    }

    .entry-desc {
      font-size: 12px;
      color: var(--ink-3);
      line-height: 1.6;
      margin: 9px 0 0 0;
      font-style: bold;
    }

    .entry-desc:first-child { margin-top: 0; }

    .entry-desc--bullet {
      padding-left: 1.25rem;
      text-indent: -1.25rem;
    }

    .entry-subtitle {
      font-weight: 400;
      font-size: 13px;
      color: var(--ink-1);
      margin: 0.9rem 0 2px 0;
    }

    .entry-subtitle:first-child { margin-top: 0; }

    /* ── Sub-labels (### headings) ── */
    .sub-label {
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink-4);
      margin: 1rem 0 0.4rem 0;
    }

    /* ── Lists ── */
    .cv-list {
      margin: 0;
      padding: 0;
    }

    .cv-list li {
      font-size: 12px;
      color: var(--ink-3);
      line-height: 1.75;
      list-style: none;
    }

    .cv-list li::before { content: none; }


    /* ── Inline date spans (year prefix in list items) ── */
    .item-date {
      color: var(--ink-4);
    }

    /* ── Tables ── */
    .cv-table {
      border-collapse: collapse;
      table-layout: fixed;
      width: 100%;
      font-size: 12px;
      margin-bottom: 0.75rem;
    }

    .cv-table th,
    .cv-table td {
      overflow-wrap: break-word;
      word-break: break-word;
      vertical-align: top;
    }

    .cv-table th {
      text-align: left;
      font-weight: 400;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink-4);
      padding: 0 14px 6px 0;
      border-bottom: 0.5px solid var(--rule-2);
    }

    .cv-table td {
      padding: 5px 14px 5px 0;
      color: var(--ink-2);
      border-bottom: 0.5px solid var(--rule-3);
    }

    /* col 1 — dates */
    .cv-table th:first-child,
    .cv-table td:first-child {
      width: 72px;
      color: var(--ink-4);
      font-size: 11px;
    }

    /* col 2 — course codes / institutions */
    .cv-table th:nth-child(2),
    .cv-table td:nth-child(2) {
      width: 155px;
    }

    /* col 3 — titles / qualifications — fills remaining space, wraps freely */

    /* ── Links ── */
    a {
      color: inherit;
      text-decoration: none;
      border-bottom: 0.5px solid var(--rule-1);
    }

    a:hover { border-bottom-color: var(--ink-4); }

    /* ── External link icon ── */
    .ext-icon {
      display: inline-block;
      width: 9px;
      height: 9px;
      fill: currentColor;
      opacity: 0.45;
      vertical-align: middle;
      margin-left: 3px;
      position: relative;
      top: -1px;
      flex-shrink: 0;
    }

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
      .resume-body { grid-template-columns: 1fr; }
      .section-divider { grid-column: 1; margin-top: 0.25rem; }
      .section-label { padding: 0.75rem 0 0.2rem 0; border: none; }
      .section-content { padding: 0.25rem 0 0.75rem 0; }
      .entry-header { flex-wrap: wrap; gap: 2px; }
      .entry-date { width: 100%; order: -1; font-size: 10px; }
      .cv-table { font-size: 11px; }
      .cv-table th, .cv-table td { padding-right: 8px; }
      .cv-table th:first-child, .cv-table td:first-child { width: 58px; }
      .cv-table th:nth-child(2), .cv-table td:nth-child(2) { width: 100px; }
      .theme-toggle { top: 0.6rem; right: 0.6rem; }
    }

    /* ── Print ── */
    @media print {
      body { padding: 0; }
      .resume { max-width: 100%; }
      .theme-toggle { display: none; }
    }
  </style>
</head>
<body>

<button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
  <svg id="toggle-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path id="toggle-path" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>
  </svg>
  <span id="toggle-label">Dark</span>
</button>

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

<script>
  (function () {
    const root   = document.documentElement;
    const btn    = document.getElementById('theme-toggle');
    const label  = document.getElementById('toggle-label');
    const path   = document.getElementById('toggle-path');

    // Sun icon path
    const SUN  = 'M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7zm0-4a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V4a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zm9-9h-1a1 1 0 0 1 0-2h1a1 1 0 0 1 0 2zM4 12a1 1 0 0 1-1 1H2a1 1 0 0 1 0-2h1a1 1 0 0 1 1 1zm14.95 5.54-.7-.71a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1-1.41 1.42zm-13.9 0a1 1 0 0 1-1.41-1.41l.7-.71a1 1 0 1 1 1.42 1.42l-.71.7zM18.24 6.46a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.41 1.41l-.7.71a1 1 0 0 1-1.42 0zm-13.9 0a1 1 0 0 1-1.41 0l-.71-.71A1 1 0 0 1 3.63 4.34l.71.71a1 1 0 0 1 0 1.41z';
    // Moon icon path
    const MOON = 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z';

    function applyTheme(dark) {
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      path.setAttribute('d', dark ? SUN : MOON);
      label.textContent = dark ? 'Light' : 'Dark';
    }

    // Restore saved preference
    const saved = localStorage.getItem('cv-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved ? saved === 'dark' : prefersDark);

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

// ── Output directories ────────────────────────────────────────────────────────
// The generated HTML is written to every folder listed here, in addition to
// the primary output path. Add or remove paths to suit your setup.

const MIRROR_DIRS = [
  path.join(__dirname), // ~/resumes/
  path.join(os.homedir(), "Desktop/Job Applications/CVs/resumé updater"), // ~/Desktop/.../resumé updater/
];

// ── Module exports (for use as a helper by md-to-resumes.js) ─────────────────

module.exports = { parseMarkdown, buildHTML, renderInline, escapeHtml };

// ── Main (only runs when called directly as a CLI tool) ───────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: node md-to-resume.js <input.md> [output.html]");
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputName = args[1]
    ? path.basename(args[1])
    : path.basename(inputPath).replace(/\.md$/i, ".html");

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: file not found — ${inputPath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(inputPath, "utf-8");
  const cv = parseMarkdown(markdown);
  const html = buildHTML(cv);

  // Write to every mirror directory that exists
  let written = 0;
  for (const dir of MIRROR_DIRS) {
    if (!fs.existsSync(dir)) {
      console.warn(`⚠  Skipping missing directory: ${dir}`);
      continue;
    }
    const dest = path.join(dir, outputName);
    fs.writeFileSync(dest, html, "utf-8");
    console.log(`✓  ${dest}`);
    written++;
  }

  if (written === 0) {
    console.error("Error: no output directories were available.");
    process.exit(1);
  }
}
