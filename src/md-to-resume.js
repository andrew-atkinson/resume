#!/usr/bin/env node
/**
 * md-to-resume.js
 * Accepts a Markdown CV, generates the structured JSON via resume-to-json.js,
 * then renders a single styled HTML resume from that JSON.
 *
 * Usage (CLI):
 *   node src/md-to-resume.js input.md              → writes input.html
 *   node src/md-to-resume.js input.md output.html  → writes output.html
 *
 * Exports (for md-to-resumes.js):
 *   buildHTMLFromJSON(cv)   – cv = { name, contact, sections }
 *   escapeHtml(str)
 *   renderInline(str)
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const { parseCV } = require("./resume-to-json.js");

// ── Inline markdown renderer ──────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// SVG appended after external links
const EXT_ICON = `<svg class="ext-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 9V1h4v1H2v7h7V5h1v4H1z"/><path d="M9 1H6l1.1 1.1L4 5.2l.8.8 3.1-3.1L9 4V1z"/></svg>`;

function externalAttrs(url) {
  return /^https?:\/\//i.test(url)
    ? { attrs: ' target="_blank" rel="noopener external"', icon: EXT_ICON }
    : { attrs: "", icon: "" };
}

function renderInline(text) {
  const urls = [];
  const links = [];

  text = text.replace(/(https?:\/\/[^\s)]+)/g, (url) => {
    urls.push(url);
    return `\x00U${urls.length - 1}\x00`;
  });

  text = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, label, ref) => {
    links.push({ label, ref });
    return `\x01L${links.length - 1}\x01`;
  });

  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<span class='entry-subtitle'>$1</span>");
  text = text.replace(/\*([^*\n]+)\*/g, "<em>--$1</em>");
  text = text.replace(/_([^_\n]+)_/g, "<em>$1</em>");

  text = text.replace(/\x01L(\d+)\x01/g, (_, i) => {
    const { label, ref } = links[parseInt(i)];
    const uMatch = ref.match(/^\x00U(\d+)\x00$/);
    const url = uMatch ? urls[parseInt(uMatch[1])] : ref;
    if (uMatch) urls[parseInt(uMatch[1])] = null;

    let l = escapeHtml(label);
    l = l.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    l = l.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    l = l.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    l = l.replace(/_([^_\n]+)_/g, "<em>$1</em>");

    const { attrs, icon } = externalAttrs(url);
    return `<a href="${escapeHtml(url)}"${attrs}>${l}${icon}</a>`;
  });

  text = text.replace(/\x00U(\d+)\x00/g, (_, i) => {
    const url = urls[parseInt(i)];
    if (!url) return "";
    const { attrs, icon } = externalAttrs(url);
    return `<a href="${escapeHtml(url)}"${attrs}>${escapeHtml(url)}${icon}</a>`;
  });

  return text;
}

// ── Helpers shared with md-to-resumes.js ─────────────────────────────────────

/** Strip markdown link and emphasis markup, return plain text. */
function stripInline(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[_*`]/g, "")
    .trim();
}

/**
 * Format a year-range from a JSON entry's year/yearEnd/present fields.
 * Returns e.g. "2004–present", "2000–04", "2019–24", "2022".
 */
function formatDateRange(entry) {
  if (!entry || !entry.year) return "";
  const s = String(entry.year);
  if (entry.present) return `${s}–present`;
  if (!entry.yearEnd) return s;
  const span       = entry.yearEnd - entry.year;
  const sameDecade = Math.floor(entry.yearEnd / 10) === Math.floor(entry.year / 10);
  const eStr       = span <= 9 && sameDecade
    ? String(entry.yearEnd).slice(-2)
    : String(entry.yearEnd);
  return `${s}–${eStr}`;
}

// ── JSON section renderers ────────────────────────────────────────────────────

/** Render a table from typed JSON entries. */
function renderTableEntries(entries, type) {
  if (!entries || !entries.length) return "";
  let headers, rowFn;
  if (type === "education") {
    headers = ["Dates", "Institution", "Qualification"];
    rowFn   = e => [formatDateRange(e), e.title || "", e.content || ""];
  } else {
    // Classes Taught: content = course code, title = course name
    headers = ["Dates", "Code", "Course"];
    rowFn   = e => [formatDateRange(e), e.content || "", e.title || ""];
  }

  let html = '<table class="cv-table"><thead><tr>';
  html += headers.map(h => `<th>${escapeHtml(h)}</th>`).join("");
  html += "</tr></thead><tbody>";
  for (const e of entries) {
    const cells = rowFn(e);
    html += "<tr>" + cells.map(c => `<td>${renderInline(c)}</td>`).join("") + "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

/** Render a Professional Experience or merged experience+service entry. */
function renderExperienceEntry(e) {
  const titleFull = [e.title, e.place].filter(Boolean).join(", ");
  const datePart  = formatDateRange(e);

  let html = `<div class="entry-subtitle">${escapeHtml(titleFull)}`;
  if (datePart) html += ` <span class="entry-date">${escapeHtml(datePart)}</span>`;
  html += "</div>";

  if (e.content) {
    const bullets = e.content.split("\n").filter(Boolean);
    for (const b of bullets) {
      html += `<div class="entry-desc">${renderInline(b)}</div>`;
    }
  }
  return html;
}

/** Render a University Service or Professional Service entry. */
function renderServiceEntry(e) {
  const datePart = formatDateRange(e);
  let html = `<div class="entry-subtitle">${escapeHtml(e.title || "")}`;
  if (datePart) html += ` <span class="entry-date">${escapeHtml(datePart)}</span>`;
  html += "</div>";

  if (e.content) {
    for (const p of e.content.split("\n").filter(Boolean)) {
      html += `<div class="entry-desc">${renderInline(p)}</div>`;
    }
  }
  return html;
}

/**
 * Render a dated list entry (exhibitions, grants, workshops, residencies,
 * bibliography, etc.).  Handles optional link.
 */
function renderListEntry(e) {
  const datePart   = formatDateRange(e);
  const displayText = [e.title, e.place].filter(Boolean).join(", ") || e.content || "";

  let innerHtml;
  if (e.link) {
    const { attrs, icon } = externalAttrs(e.link.url);
    const url             = escapeHtml(e.link.url);
    const linkedLabel     = stripInline(e.link.linkTitle);

    if (displayText.includes(linkedLabel)) {
      const idx  = displayText.indexOf(linkedLabel);
      const pre  = escapeHtml(displayText.slice(0, idx));
      const post = escapeHtml(displayText.slice(idx + linkedLabel.length));
      innerHtml  = `${pre}<a href="${url}"${attrs}>${escapeHtml(linkedLabel)}${icon}</a>${post}`;
    } else {
      innerHtml = `<a href="${url}"${attrs}>${escapeHtml(displayText)}${icon}</a>`;
    }
  } else {
    innerHtml = renderInline(displayText);
  }

  const dateHtml = datePart
    ? `<span class="item-date">${escapeHtml(datePart)} —</span> `
    : "";
  return `<li>${dateHtml}${innerHtml}</li>`;
}

/**
 * Dispatch section rendering based on section name and structure.
 * Handles both { section, entries[] } and { section, subsections[] } shapes.
 */
function renderSectionFromJSON(sec) {
  const name = sec.section;

  // ── Sections that use ### sub-headings ──────────────────────────────────────
  if (sec.subsections) {
    const isClasses = name === "Classes Taught";
    return sec.subsections.map(sub => {
      const innerHtml = isClasses
        ? renderTableEntries(sub.entries, "classes")
        : `<ul class="cv-list">${sub.entries.map(renderListEntry).join("")}</ul>`;
      return `<div class="sub-label">${escapeHtml(sub.title)}</div>${innerHtml}`;
    }).join("\n");
  }

  const entries = sec.entries || [];

  switch (name) {
    case "Education":
      return renderTableEntries(entries, "education");

    case "Professional Experience":
      return entries.map(renderExperienceEntry).join("\n");

    case "University Service":
    case "Professional Service":
      return entries.map(renderServiceEntry).join("\n");

    case "Profile":
      return entries
        .map(e => `<p class="summary">${renderInline(e.content || "")}</p>`)
        .join("\n");

    default:
      // Dated bullet lists: Exhibitions, Grants, Workshops, Residencies, Collections
      return `<ul class="cv-list">${entries.map(renderListEntry).join("")}</ul>`;
  }
}

// ── Contact item renderer ─────────────────────────────────────────────────────

const LINKEDIN_LOGO = `<svg class="contact-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
</svg>`;

function renderContactItem(raw) {
  const linkMatch = raw.match(/^\[(.+?)\]\((.+?)\)$/);
  if (linkMatch) {
    const isLinkedIn = linkMatch[2].includes("linkedin.com");
    const label      = escapeHtml(isLinkedIn ? "LinkedIn" : linkMatch[1]);
    const url        = escapeHtml(linkMatch[2]);
    const liIcon     = isLinkedIn ? LINKEDIN_LOGO : "";
    const { attrs, icon } = externalAttrs(linkMatch[2]);
    return `<a href="${url}"${attrs}>${liIcon}${label}${icon}</a>`;
  }
  return `<span>${escapeHtml(raw)}</span>`;
}

// ── Build date ────────────────────────────────────────────────────────────────

function buildDateString() {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const d = new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ── HTML builder ──────────────────────────────────────────────────────────────

/**
 * Render a complete HTML resume page from a parsed CV object.
 * @param {object} cv  { name: string, contact: string[], sections: object[] }
 *                     sections is the same array produced by resume-to-json.js,
 *                     optionally filtered/transformed by md-to-resumes.js.
 */
function buildHTMLFromJSON(cv) {
  const contactHTML = cv.contact.map(renderContactItem).join("\n      ");

  // Profile section (if present) renders above the grid body
  const profileSec  = cv.sections.find(s => s.section === "Profile");
  const bodySections = cv.sections.filter(s => s.section !== "Profile");

  const profileHTML = profileSec ? `
    <div class="section">
      <div class="section-divider"></div>
      <div class="section-label">Profile</div>
      <div class="section-content">
        ${renderSectionFromJSON(profileSec)}
      </div>
    </div>` : "";

  const sectionsHTML = bodySections.map(s => `
    <div class="section">
      <div class="section-divider"></div>
      <div class="section-label">${escapeHtml(s.section)}</div>
      <div class="section-content">
        ${renderSectionFromJSON(s)}
      </div>
    </div>`).join("\n");

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
    .theme-toggle:hover { color: var(--ink-2); border-color: var(--ink-4); }
    .theme-toggle svg   { width: 12px; height: 12px; fill: currentColor; flex-shrink: 0; }

    /* ── Header ── */
    .resume-header { padding-bottom: 1.25rem; margin-bottom: 0.75rem; }

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
    .resume-body { display: grid; grid-template-columns: 200px 1fr; gap: 0; }

    .section { display: contents; }

    .section-divider { grid-column: 1 / -1; border-top: 0.5px solid var(--rule-1); }

    .section-label {
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink-4);
      padding: 1.25rem 1rem 0 0;
      line-height: 1.4;
    }

    .section-content { padding: 1.25rem 0; }

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

    .entry-title { font-weight: 400; color: var(--ink-1); font-size: 13px; }

    .entry-title--org {
      font-family: 'Cormorant Garamond', serif;
      font-style: italic;
      font-size: 15px;
      font-weight: 500;
      color: var(--ink-1);
    }

    .entry-date { font-size: 11px; color: var(--ink-4); white-space: nowrap; flex-shrink: 0; }

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

    .entry-desc--bullet { padding-left: 1.25rem; text-indent: -1.25rem; }

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
    .cv-list { margin: 0; padding: 0; }

    .cv-list li {
      font-size: 12px;
      color: var(--ink-3);
      line-height: 1.75;
      list-style: none;
    }

    .cv-list li::before { content: none; }

    /* ── Inline date spans ── */
    .item-date { color: var(--ink-4); }

    /* ── Tables ── */
    .cv-table {
      border-collapse: collapse;
      table-layout: fixed;
      width: 100%;
      font-size: 12px;
      margin-bottom: 0.75rem;
    }

    .cv-table th, .cv-table td {
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

    .cv-table th:first-child, .cv-table td:first-child { width: 72px; color: var(--ink-4); font-size: 11px; }
    .cv-table th:nth-child(2), .cv-table td:nth-child(2) { width: 155px; }

    /* ── Links ── */
    a { color: inherit; text-decoration: none; border-bottom: 0.5px solid var(--rule-1); }
    a:hover { border-bottom-color: var(--ink-4); }

    /* ── External link icon ── */
    .ext-icon {
      display: inline-block;
      width: 9px; height: 9px;
      fill: currentColor;
      opacity: 0.45;
      vertical-align: middle;
      margin-left: 3px;
      position: relative; top: -1px;
      flex-shrink: 0;
    }

    /* ── Contact icons ── */
    .contact-icon {
      display: inline-block;
      width: 11px; height: 11px;
      fill: currentColor;
      vertical-align: middle;
      margin-right: 4px;
      position: relative; top: -1px;
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

    /* ── Updated line ── */
    .resume-updated {
      margin-top: 2rem;
      padding-top: 0.75rem;
      border-top: 0.5px solid var(--rule-1);
      font-size: 10px;
      color: var(--ink-4);
      text-align: right;
    }

    /* ── Print ── */
    @media print { body { padding: 0; } .resume { max-width: 100%; } .theme-toggle { display: none; } }
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
    ${profileHTML}
    ${sectionsHTML}
  </div>

  <div class="resume-updated">updated: ${buildDateString()}</div>

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

// ── Output directories ────────────────────────────────────────────────────────

const MIRROR_DIRS = [
  path.join(__dirname, ".."),
  path.join(os.homedir(), "Desktop/Job Applications/CVs/resumé updater"),
];

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = { buildHTMLFromJSON, renderInline, escapeHtml, formatDateRange, stripInline };

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node src/md-to-resume.js <input.md> [output.html]");
    process.exit(1);
  }

  const inputPath  = path.resolve(args[0]);
  const outputName = args[1]
    ? path.basename(args[1])
    : path.basename(inputPath).replace(/\.md$/i, ".html");

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: file not found — ${inputPath}`);
    process.exit(1);
  }

  const md = fs.readFileSync(inputPath, "utf-8");

  // 1. Parse to JSON and write the .json file alongside the .md
  const cv      = parseCV(md);
  const jsonOut = path.join(path.dirname(inputPath), path.basename(inputPath).replace(/\.md$/i, ".json"));
  fs.writeFileSync(jsonOut, JSON.stringify(cv, null, 2), "utf-8");
  console.log(`✓  JSON → ${jsonOut}`);

  // 2. Render HTML from JSON
  const html = buildHTMLFromJSON(cv);

  let written = 0;
  for (const dir of MIRROR_DIRS) {
    if (!fs.existsSync(dir)) {
      console.warn(`⚠  Skipping missing directory: ${dir}`);
      continue;
    }
    const dest = path.join(dir, outputName);
    fs.writeFileSync(dest, html, "utf-8");
    console.log(`✓  HTML → ${dest}`);
    written++;
  }

  if (written === 0) {
    console.error("Error: no output directories were available.");
    process.exit(1);
  }
}
