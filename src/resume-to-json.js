#!/usr/bin/env node
/**
 * resume-to-json.js  (lives in /src alongside the source .md)
 *
 * Parses Atkinson_CV.md into a structured JSON file.
 *
 * Top-level output shape — array of section objects:
 *
 *   {
 *     section: string
 *     entries?: Entry[]          – sections with no sub-headings
 *     subsections?: {            – sections that have ### sub-headings
 *       title: string
 *       entries: Entry[]
 *     }[]
 *   }
 *
 * Entry shape:
 *   {
 *     title?:   string
 *     place?:   string
 *     content?: string
 *     year?:    number
 *     yearEnd?: number           – present when end year is a specific year
 *     present?: true             – present instead of yearEnd when still ongoing
 *     link?:    { url: string, linkTitle: string }
 *   }
 */

const fs   = require('fs');
const path = require('path');

// ─── default paths (used when run as a CLI) ───────────────────────────────────
const INPUT  = path.join(__dirname, 'Atkinson_CV.md');
const OUTPUT = path.join(__dirname, 'Atkinson_CV.json');

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Strip inline markdown emphasis; keep plain text. */
function stripInline(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [label](url) → label
    .replace(/[_*`]/g, '')
    .trim();
}

/** Extract the first markdown link from a text fragment. */
function extractLink(text) {
  const m = text.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return m ? { url: m[2], linkTitle: m[1] } : null;
}

/**
 * Parse a date-range string.
 * Returns { year?, yearEnd?, present? }
 *
 * - present:true is set (and yearEnd omitted) when the range ends in "present"
 * - yearEnd is set when the range ends in a specific year
 * - only year is set when there is a single year
 *
 * Handles: "2004–present", "Oct 2000 – May 2004", "Spring – Summer 2017",
 *          "1997–2003", "2019–24" (short end year), "2017–19, '22–23"
 */
function parseYearRange(raw) {
  if (!raw) return {};
  const s = raw.trim();

  // All explicit 4-digit years
  const fullYears = [...s.matchAll(/\b(\d{4})\b/g)].map(m => parseInt(m[1]));

  // Short 2-digit end years like "–19" or "'22"
  const shortYears = [...s.matchAll(/[–'\-](\d{2})\b/g)].map(m => {
    const n = parseInt(m[1]);
    return n <= 30 ? 2000 + n : 1900 + n;
  });

  const allYears = [...fullYears, ...shortYears].sort((a, b) => a - b);
  if (!allYears.length) return {};

  const year      = allYears[0];
  const isPresent = /present/i.test(s);
  const yearEnd   = !isPresent && allYears.length > 1
    ? allYears[allYears.length - 1]
    : undefined;

  const result = { year };
  if (isPresent)              result.present = true;
  else if (yearEnd !== undefined) result.yearEnd = yearEnd;
  return result;
}

/**
 * Parse a dated bullet of the form:
 *   "- 2022 — Event Title, Venue, City"
 *   "- 2004–present — Role, Organisation"
 *
 * Returns a partial entry object (no `section` / `subsection`).
 */
function parseDatedBullet(raw) {
  const line = raw.replace(/^-\s*/, '').trim();

  // Year range at the start of the bullet
  const yearRangeRe = /^([\d]{4}(?:[–\-][\d]{2,4})?(?:,\s*'[\d]{2}[–\-][\d]{2})?)\s*[—–]\s*/;
  const yrMatch     = line.match(yearRangeRe);

  let dateStr = '';
  let rest    = line;
  if (yrMatch) {
    dateStr = yrMatch[1];
    rest    = line.slice(yrMatch[0].length).trim();
  }

  const { year, yearEnd, present } = parseYearRange(dateStr);
  const link = extractLink(rest);

  // When the whole content is a markdown link, split on the link's label text
  // so commas inside "[A, B, C](url)" don't corrupt the title/place split.
  const splitSource = link ? link.linkTitle : rest;

  let title, place, content;
  if (splitSource.includes(',')) {
    const ci = splitSource.indexOf(',');
    title = splitSource.slice(0, ci).trim();
    place = splitSource.slice(ci + 1).trim();
  } else {
    content = stripInline(rest);
  }

  const entry = {};
  if (year    !== undefined) entry.year    = year;
  if (present)               entry.present = true;
  else if (yearEnd !== undefined) entry.yearEnd = yearEnd;
  if (title   !== undefined) entry.title   = title;
  if (place   !== undefined) entry.place   = place;
  if (content !== undefined) entry.content = content;
  if (link)                  entry.link    = link;
  return entry;
}

// ─── main parser ──────────────────────────────────────────────────────────────

/**
 * Parse the markdown into a flat array of entries, each tagged with
 * `section` and optionally `subsection`. These are grouped in a second pass.
 */
function parseFlat(md) {
  const lines   = md.split('\n');
  const entries = [];

  let section    = '';
  let subsection = '';
  let inTable    = false;
  let lastEntry  = null;

  function push(obj) {
    entries.push(obj);
    lastEntry = obj;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw  = lines[i];
    const line = raw.trim();

    // ── headings ─────────────────────────────────────────────────────────────
    if (/^# [^#]/.test(line)) continue;   // h1 — skip name

    if (line.startsWith('## ')) {
      section    = line.slice(3).trim();
      subsection = '';
      inTable    = false;
      lastEntry  = null;
      continue;
    }

    if (line.startsWith('### ')) {
      subsection = line.slice(4).trim();
      inTable    = false;
      continue;
    }

    // Blank line inside Profile = paragraph break: reset lastEntry so the next
    // Profile line opens a new entry (paragraph) rather than appending.
    if (!line && section === 'Profile' && lastEntry?.section === 'Profile') {
      lastEntry = null;
      continue;
    }

    if (line === '---' || !line || !section) continue;

    // ═════════════════════════════════════════════════════════════════════════
    // PROFILE
    // ═════════════════════════════════════════════════════════════════════════
    if (section === 'Profile') {
      if (lastEntry && lastEntry.section === 'Profile') {
        lastEntry.content += ' ' + line;
      } else {
        push({ section: 'Profile', content: line });
      }
      continue;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TABLES  (Education, Classes Taught)
    // ═════════════════════════════════════════════════════════════════════════
    if (line.startsWith('|')) {
      if (!inTable) {
        inTable = true;
        i++;   // skip separator row
        continue;
      }

      const cells = line.split('|').map(c => c.trim()).filter(Boolean);

      if (section === 'Education') {
        const { year, yearEnd, present } = parseYearRange(cells[0]);
        const entry = {
          section: 'Education',
          title:   stripInline(cells[1] || ''),
          content: stripInline(cells[2] || ''),
        };
        if (year    !== undefined) entry.year    = year;
        if (present)               entry.present = true;
        else if (yearEnd !== undefined) entry.yearEnd = yearEnd;
        push(entry);
        continue;
      }

      if (section === 'Classes Taught') {
        const { year, yearEnd, present } = parseYearRange(cells[0]);
        const entry = {
          section:    'Classes Taught',
          subsection,
          title:      stripInline(cells[2] || ''),  // course name
          content:    stripInline(cells[1] || ''),  // course code
        };
        if (year    !== undefined) entry.year    = year;
        if (present)               entry.present = true;
        else if (yearEnd !== undefined) entry.yearEnd = yearEnd;
        push(entry);
        continue;
      }

      continue;  // unknown table
    } else {
      inTable = false;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PROFESSIONAL EXPERIENCE
    // ═════════════════════════════════════════════════════════════════════════
    if (section === 'Professional Experience') {
      if (line.startsWith('**')) {
        const titleM = line.match(/\*\*([^*]+)\*\*/);
        const dateM  = line.match(/_([^_]+)_/);
        const { year, yearEnd, present } = parseYearRange(dateM ? dateM[1] : '');

        const boldText = titleM ? titleM[1].trim() : stripInline(line);
        let title = boldText, place;
        if (boldText.includes(',')) {
          const ci = boldText.indexOf(',');
          title = boldText.slice(0, ci).trim();
          place = boldText.slice(ci + 1).trim();
        }

        const entry = { section: 'Professional Experience', title };
        if (place !== undefined) entry.place = place;
        if (year  !== undefined) entry.year  = year;
        if (present)             entry.present = true;
        else if (yearEnd !== undefined) entry.yearEnd = yearEnd;
        entry.content = '';
        push(entry);
        continue;
      }

      if (line.startsWith('-') && lastEntry?.section === 'Professional Experience') {
        lastEntry.content += (lastEntry.content ? '\n' : '') + line.replace(/^-\s*/, '').trim();
        continue;
      }

      continue;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // UNIVERSITY SERVICE
    // ═════════════════════════════════════════════════════════════════════════
    if (section === 'University Service') {
      if (line.startsWith('**')) {
        push({ section: 'University Service', title: line.replace(/\*\*/g, '').trim(), content: '' });
        continue;
      }
      if (lastEntry?.section === 'University Service') {
        lastEntry.content += (lastEntry.content ? ' ' : '') + line;
      }
      continue;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PROFESSIONAL SERVICE
    // ═════════════════════════════════════════════════════════════════════════
    if (section === 'Professional Service') {
      if (line.startsWith('**')) {
        const titleM = line.match(/\*\*([^*]+)\*\*/);
        const title  = titleM ? titleM[1].trim() : stripInline(line);

        // Date range might be in an _italic_ span on the same line
        const dateM = line.match(/_([^_]+)_/);
        const { year, yearEnd, present } = parseYearRange(dateM ? dateM[1] : '');

        const entry = { section: 'Professional Service', title, content: '' };
        if (year  !== undefined) entry.year  = year;
        if (present)             entry.present = true;
        else if (yearEnd !== undefined) entry.yearEnd = yearEnd;
        push(entry);
        continue;
      }

      if (line.startsWith('-')) {
        const bullet = line.replace(/^-\s*/, '').trim();
        if (lastEntry?.section === 'Professional Service') {
          lastEntry.content += (lastEntry.content ? '\n' : '') + bullet;
        } else {
          push({ section: 'Professional Service', ...parseDatedBullet(line) });
        }
        continue;
      }

      // Plain paragraph (e.g. "2020–24 — Board Member, …")
      // Promote year to the parent entry if it doesn't have one yet.
      if (lastEntry?.section === 'Professional Service') {
        const { year, yearEnd, present } = parseYearRange(line);
        if (year !== undefined && lastEntry.year === undefined) {
          lastEntry.year = year;
          if (present)             lastEntry.present = true;
          else if (yearEnd !== undefined) lastEntry.yearEnd = yearEnd;
        }
        lastEntry.content += (lastEntry.content ? ' ' : '') + stripInline(line);
      }
      continue;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SCHOLARSHIP, PUBLICATIONS, AND RELATED ACTIVITIES
    // ═════════════════════════════════════════════════════════════════════════
    if (section === 'Scholarship, Publications, and Related Activities') {
      if (line.startsWith('-')) {
        const parsed = parseDatedBullet(line);
        push({ section: 'Scholarship, Publications, and Related Activities', subsection, ...parsed });
        continue;
      }
      if (!line.startsWith('#')) {
        const link = extractLink(line);
        const { year, yearEnd, present } = parseYearRange(line);
        const entry = {
          section:    'Scholarship, Publications, and Related Activities',
          subsection,
          content:    stripInline(line),
        };
        if (year  !== undefined) entry.year  = year;
        if (present)             entry.present = true;
        else if (yearEnd !== undefined) entry.yearEnd = yearEnd;
        if (link)                entry.link  = link;
        push(entry);
        continue;
      }
      continue;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SIMPLE DATED BULLET-LIST SECTIONS
    // ═════════════════════════════════════════════════════════════════════════
    const datedListSections = [
      'Selected Exhibitions',
      'Grants',
      'Workshops, Lectures & Presentations',
      'Artist Residencies',
    ];

    if (datedListSections.includes(section) && line.startsWith('-')) {
      push({ section, ...parseDatedBullet(line) });
      continue;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COLLECTIONS  (plain list, no dates)
    // ═════════════════════════════════════════════════════════════════════════
    if (section === 'Collections' && line.startsWith('-')) {
      push({ section: 'Collections', content: line.replace(/^-\s*/, '').trim() });
      continue;
    }
  }

  // Remove empty string values
  return entries.map(e => {
    const out = {};
    for (const [k, v] of Object.entries(e)) {
      if (v === '' || v === null || v === undefined) continue;
      out[k] = v;
    }
    return out;
  });
}

// ─── grouping pass ────────────────────────────────────────────────────────────

/**
 * Convert a flat entry array into the final hierarchical structure:
 *   [ { section, entries[] } ]         — no sub-headings
 *   [ { section, subsections[{title, entries[]}] } ]  — has sub-headings
 */
function groupBySection(flatEntries) {
  const sectionOrder = [];
  const sectionMap   = new Map();

  for (const entry of flatEntries) {
    const { section, subsection, ...rest } = entry;

    if (!sectionMap.has(section)) {
      sectionMap.set(section, { subOrder: [], subMap: new Map() });
      sectionOrder.push(section);
    }

    const sec    = sectionMap.get(section);
    const subKey = subsection || null;

    if (!sec.subMap.has(subKey)) {
      sec.subMap.set(subKey, []);
      sec.subOrder.push(subKey);
    }
    sec.subMap.get(subKey).push(rest);
  }

  return sectionOrder.map(sectionName => {
    const sec            = sectionMap.get(sectionName);
    const hasSubsections = sec.subOrder.some(k => k !== null);
    const out            = { section: sectionName };

    if (hasSubsections) {
      out.subsections = sec.subOrder.map(subKey => ({
        title:   subKey,
        entries: sec.subMap.get(subKey),
      }));
    } else {
      out.entries = sec.subMap.get(null) || [];
    }

    return out;
  });
}

// ─── header extraction (name + contact lines) ────────────────────────────────

/**
 * Extract the person's name (h1) and contact detail lines from the markdown
 * header block that appears before the first ## section.
 */
function extractHeader(md) {
  const lines = md.split('\n');
  const result = { name: '', contact: [] };
  let i = 0;

  // Find h1
  while (i < lines.length && !lines[i].startsWith('# ')) i++;
  if (i < lines.length) {
    result.name = lines[i].replace(/^#\s+/, '').trim();
    i++;
  }

  // Collect contact lines until first ## or ---
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('## ') || line === '---') break;
    const m = line.match(/^(Email|Tel|LinkedIn|Phone|Web|Website):\s*(.+)/i);
    if (m) result.contact.push(m[2].trim());
    i++;
  }

  return result;
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Parse a CV markdown string into the full structured object:
 *   { name, contact, sections }
 *
 * This is the primary export intended for use by downstream scripts.
 */
function parseCV(md) {
  const { name, contact } = extractHeader(md);
  const flat              = parseFlat(md);
  const sections          = groupBySection(flat);
  return { name, contact, sections };
}

module.exports = { parseCV, parseFlat, groupBySection };

// ─── CLI run (only when called directly) ─────────────────────────────────────

if (require.main === module) {
  const md  = fs.readFileSync(INPUT, 'utf8');
  const cv  = parseCV(md);
  const out = JSON.stringify(cv, null, 2);

  fs.writeFileSync(OUTPUT, out, 'utf8');

  const totalEntries = cv.sections.reduce((n, s) => {
    return n + (s.entries ? s.entries.length
               : s.subsections.reduce((m, sub) => m + sub.entries.length, 0));
  }, 0);

  console.log(`✓ Parsed ${totalEntries} entries into ${cv.sections.length} sections → ${OUTPUT}`);
  for (const sec of cv.sections) {
    if (sec.subsections) {
      const total = sec.subsections.reduce((n, s) => n + s.entries.length, 0);
      console.log(`  ${total.toString().padStart(3)}  ${sec.section}`);
      for (const sub of sec.subsections) {
        console.log(`       ${sub.entries.length.toString().padStart(3)}  ↳ ${sub.title}`);
      }
    } else {
      console.log(`  ${sec.entries.length.toString().padStart(3)}  ${sec.section}`);
    }
  }
}
