# Resume Builder

A single-source résumé pipeline. One Markdown CV file and one format specification produce as many tailored HTML résumés as you need, each automatically exported to PDF and DOCX. The root `index.html` is a GitHub Pages–compatible landing page that links to every format.

---

## Requirements

| Tool                                            | Purpose                        | Install                            |
| ----------------------------------------------- | ------------------------------ | ---------------------------------- |
| [Node.js](https://nodejs.org/) 16+              | Runs all scripts               | `brew install node`                |
| [pandoc](https://pandoc.org/)                   | Generates DOCX files           | `brew install pandoc`              |
| [Google Chrome](https://www.google.com/chrome/) | Generates PDF files            | Download from google.com/chrome    |
| [puppeteer-core](https://pptr.dev/)             | Node API for Chrome PDF export | `npm install` (once, project root) |

Run `npm install` once from the project root before first use.

---

## Project structure

```
resumes/
├── index.html              ← Landing page (GitHub Pages root)
├── artist/index.html       ← Generated résumés (one folder each)
├── academic/index.html
├── professional/index.html
├── timeline/index.html     ← Interactive career timeline
├── pdf/                    ← PDF exports
├── docx/                   ← DOCX exports
└── src/
    ├── Atkinson_CV.md      ← Source CV (edit this)
    ├── Atkinson_CV.json    ← Structured JSON (auto-generated, do not edit)
    ├── resumeFormats.md    ← Format definitions (edit this)
    ├── resume-to-json.js   ← MD → JSON parser
    ├── md-to-resume.js     ← JSON → HTML renderer (single resume)
    ├── md-to-resumes.js    ← Pipeline orchestrator (all formats)
    ├── json-to-timeline.js ← JSON → timeline HTML
    ├── html-to-exports.js  ← PDF + DOCX exporter
    └── table-fix.lua       ← Pandoc filter for DOCX table layout
```

---

## Usage

### Full pipeline

Run this single command from the project root to regenerate everything — JSON, all HTML résumés, the landing page, all PDFs, and all DOCX files:

```bash
node src/md-to-resumes.js src/Atkinson_CV.md
```

An optional second argument overrides the format spec path:

```bash
node src/md-to-resumes.js src/Atkinson_CV.md src/resumeFormats.md
```

If only one `.md` file is present in `src/`, the CV path argument can be omitted:

```bash
node src/md-to-resumes.js
```

### Single resume (standalone)

To render one self-contained HTML page directly from a CV:

```bash
node src/md-to-resume.js src/Atkinson_CV.md          # → Atkinson_CV.html
node src/md-to-resume.js src/Atkinson_CV.md out.html  # custom filename
```

The output is written to the project root and to `~/Desktop/Job Applications/CVs/resumé updater/` if that folder exists. A `.json` file is also written beside the `.md` as a side-effect.

### Timeline

To regenerate the interactive career timeline:

```bash
node src/json-to-timeline.js
```

This reads `Atkinson_CV.json` (regenerate it first if the CV has changed) and writes `timeline/index.html`. The timeline is independent of the résumé pipeline and can be run on its own.

### JSON only

To generate (or regenerate) the structured JSON without building any HTML:

```bash
node src/resume-to-json.js
```

This reads `Atkinson_CV.md` and writes `Atkinson_CV.json` in the same `src/` directory.

---

## How it works

The résumé pipeline has three stages, with the timeline as a parallel output from the same JSON intermediate:

```
Atkinson_CV.md
      │
      ▼  resume-to-json.js
Atkinson_CV.json   ← structured, typed data
      │
      ├──▶  json-to-timeline.js
      │         timeline/index.html
      │
      ▼  md-to-resumes.js  (+ resumeFormats.md)
      │    filters & transforms sections per format
      ▼  md-to-resume.js
artist/index.html, academic/index.html, professional/index.html
      │
      ▼  html-to-exports.js
pdf/Atkinson_Artist.pdf, docx/Atkinson_Artist.docx, …
```

### `src/resume-to-json.js` — Markdown → JSON parser

Parses the source `.md` file and produces a structured JSON intermediate that every downstream script works from. The JSON has the shape:

```json
{
  "name": "Andrew Atkinson",
  "contact": ["[email](mailto:…)", "…"],
  "sections": [
    {
      "section": "Education",
      "entries": [
        {
          "title": "University of the West of England",
          "content": "Ph.D.",
          "year": 2000,
          "yearEnd": 2004
        }
      ]
    },
    {
      "section": "Classes Taught",
      "subsections": [
        {
          "title": "Photography",
          "entries": [
            {
              "title": "Digital Photography and Imaging 1",
              "content": "ARPH201",
              "year": 2004,
              "yearEnd": 2023
            }
          ]
        }
      ]
    }
  ]
}
```

Each entry is a plain object with some combination of:

| Field     | Type   | Meaning                                                                |
| --------- | ------ | ---------------------------------------------------------------------- |
| `title`   | string | Institution, event, employer, or course name                           |
| `place`   | string | Venue or location (first comma-separated token after title)            |
| `content` | string | Description, qualification, course code, or prose                      |
| `year`    | number | Start year                                                             |
| `yearEnd` | number | End year (omitted when open-ended)                                     |
| `present` | true   | Set instead of `yearEnd` when the role is ongoing                      |
| `link`    | object | `{ url, linkTitle }` — present when the entry contains a Markdown link |

Sections that contain `###` sub-headings (Classes Taught, Scholarship) use `subsections: [{ title, entries[] }]` instead of a flat `entries` array.

The parser can be used as a module by other scripts:

```js
const { parseCV } = require("./resume-to-json.js");
const cv = parseCV(markdownString); // { name, contact, sections }
```

---

### `src/md-to-resume.js` — JSON → HTML renderer

Accepts a CV object `{ name, contact, sections }` and renders a complete, self-contained HTML page. All rendering works directly from the typed JSON entries — no Markdown re-parsing happens at this stage.

Each section type is rendered by a dedicated function:

| Section type              | Renderer                                            |
| ------------------------- | --------------------------------------------------- |
| Profile                   | One `<p>` per paragraph entry                       |
| Education                 | Table: Dates / Institution / Qualification          |
| Classes Taught            | Sub-labelled tables: Dates / Code / Course          |
| Professional Experience   | Bold title + muted date, then description lines     |
| University/Prof. Service  | Bold title + optional date, then prose              |
| All dated list sections   | `<ul>` with muted year prefix per item              |
| Scholarship (subsections) | Sub-labelled `<ul>` per Bibliography/Writer/Curator |

Date fields (`year`, `yearEnd`, `present`) are formatted consistently — short-form for same-decade ranges (e.g. `2019–23`), full year otherwise, and `2004–present` for ongoing roles.

Exported for use by `md-to-resumes.js`:

```js
const {
  buildHTMLFromJSON,
  escapeHtml,
  renderInline,
} = require("./md-to-resume.js");
```

---

### `src/md-to-resumes.js` — Pipeline orchestrator

Ties all three stages together. For each format defined in `resumeFormats.md` it:

1. Calls `parseCV()` from `resume-to-json.js` to get the full JSON
2. Writes the JSON file beside the source `.md`
3. Calls `getSection()` to look up each requested section by name — resolves both top-level sections and sub-sections (e.g. `Curator` inside `Scholarship, Publications, and Related Activities`)
4. Applies any transformations specified in the format (abbreviation, chronological merge)
5. Calls `buildHTMLFromJSON()` and writes the result to the output folder
6. Builds the root `index.html`
7. Invokes `html-to-exports.js` for PDF and DOCX

---

### `src/html-to-exports.js` — PDF and DOCX exporter

Reads each HTML résumé listed in `resumeFormats.md` and converts it to two formats:

**PDF** — uses Chrome headless (`--print-to-pdf`). The full CSS is preserved so the PDF matches the browser rendering exactly. Page size is A4 with 0.75 in top, 1 in bottom, and 2.5 cm side margins. Headers, footers, date, and URL watermarks are suppressed.

**DOCX** — uses pandoc. Before conversion, browser-only elements (stylesheets, scripts, theme toggle) are stripped and `div`-based section headings are promoted to semantic `<h2>`/`<h3>` so pandoc builds a correctly structured document. The `table-fix.lua` filter sets proportional column widths so tables span the full text column.

Output files are named `Lastname_Formatname.pdf` / `.docx` (e.g. `Atkinson_Artist.pdf`).

---

### `src/table-fix.lua` — Pandoc table filter

A Lua filter that runs during DOCX generation. It intercepts every table in the pandoc AST and sets left-alignment and proportional column widths. The distribution favours a wide last column (dates → 18 %, codes/institutions → 27 %, titles/descriptions → 55 %), preventing table content from overflowing page margins.

---

### `src/json-to-timeline.js` — Career timeline

Reads `Atkinson_CV.json` and generates `timeline/index.html`: a horizontal Gantt-style timeline where the X-axis is years (newest on the left) and the Y-axis is career category. Shares the same Cormorant Garamond / DM Sans typography and light/dark theme toggle as the résumé files.

**Rows and rendering modes**

| Row | Mode | Description |
| --- | ---- | ----------- |
| Education | spans | Horizontal bars scaled to duration; swim-lane tracks for overlapping entries |
| Employment | spans | Same; merges Professional Experience and Professional Service |
| Teaching | spans | All Classes Taught subsections merged into one row |
| Exhibitions | list | Up to 4 titles per year column; "+X more" expands with animated transition |
| Scholarship | points | Dot per entry, stacked by year |
| Presentations | list | Up to 2 titles per year column; "+X more" expands with animated transition |
| Grants & Residencies | points | Dot per entry, stacked by year |

Education, Employment, and Teaching each use a distinct warm-grey value for their bars so the three span rows are visually differentiated without competing with the text.

**Interactivity**

- **Expand / collapse** — clicking "+X more" in an Exhibitions or Presentations column unfolds the hidden entries and slides the rows below down with a CSS `height` + `max-height` transition. Clicking "Show less" collapses them back.
- **Hover label** — if a label is truncated by its column boundary, hovering (mouse) reveals the full text in a floating tooltip.
- **Detail popup** — clicking any entry (bar, dot, or list item) opens a centred modal showing the full title, place, date, and any descriptive content. It closes on the backdrop, the × button, or Escape.

**Layout constants** (in `json-to-timeline.js`)

| Constant | Value | Effect |
| -------- | ----- | ------ |
| `PX_PER_YEAR` | 80 | Horizontal scale — increase to widen the chart |
| `MIN_YEAR` / `MAX_YEAR` | 1993 / 2028 | Year range rendered |
| `SPAN_TRACK_H` | 28 px | Height of each swim-lane track |
| `ITEM_H` | 17 px | Height of each list / point row |
| `MAX_EXH_VISIBLE` (exhibitions `maxLines`) | 4 | Lines shown before collapse |
| `MAX_PRES_VISIBLE` (presentations `maxLines`) | 2 | Lines shown before collapse |

---

## Input files

### CV source — `src/Atkinson_CV.md`

The single source of truth for all résumé content.

#### Header block

The first line must be the name as an H1. Contact fields follow immediately — one per line, using `Label: value` syntax. Supported labels: `Email`, `Tel`, `Phone`, `Website`, `Web`, `LinkedIn`. Values may be plain text or Markdown links. LinkedIn links are detected automatically and rendered with the LinkedIn logo in HTML.

```markdown
# Your Name

Email: [you@example.com](mailto:you@example.com)
Tel: [212 000 0000](tel:2120000000)
Website: [yoursite.com](https://yoursite.com)
LinkedIn: [yourhandle](https://www.linkedin.com/in/yourhandle/)
```

#### Profile

A `## Profile` section whose content is one or more plain paragraphs separated by blank lines. Each paragraph becomes a separate `<p>` in the HTML output.

```markdown
## Profile

First paragraph of biographical text.

Second paragraph continues the bio.
```

#### Sections

`##` headings define CV sections. The heading text becomes the left-column label in the HTML layout and the key used to look up sections by name in `resumeFormats.md`.

```markdown
## Education

## Professional Experience

## Selected Exhibitions
```

#### Sub-sections

`###` headings create labelled sub-groups within a section (e.g. courses grouped by discipline, scholarship grouped by type). Sub-section names can be referenced directly in `resumeFormats.md`.

```markdown
## Classes Taught

### Photography

### Creative Coding and Digital Arts
```

#### Tables

Markdown tables are parsed into typed entries by the JSON parser (dates in column 1, institution/code in column 2, qualification/title in column 3). They render as clean, proportionally-sized HTML tables.

```markdown
| Dates     | Institution                       | Qualification      |
| --------- | --------------------------------- | ------------------ |
| 2000–2004 | University of the West of England | Ph.D.              |
| 1993–1996 | University of the West of England | BA (hons) Fine Art |
```

#### Professional experience entries

`**bold** — _italic_` pairs render as title–date entries. Bullet points immediately below become description lines. The location after the first comma in the bold text is parsed as a separate `place` field.

```markdown
**Montclair State University, Montclair, NJ** — _2004–present_

- Assistant Professor of Digital Photography
- Director of the MFA in Studio Arts, 2009–2017
```

#### Dated bullet lists

Used for exhibitions, grants, workshops, residencies, and bibliography items. The leading year (or year range) is parsed into `year`/`yearEnd`/`present` fields and styled in muted grey in the HTML. The first comma in the remaining text splits `title` from `place`.

```markdown
- 2022 — Exhibition Title, Venue Name, City, Country
- 2004–present — Ongoing project, Organisation
```

Markdown links within a bullet item are captured as a `link` object and rendered as hyperlinks with an external-link icon.

#### Bold sub-headings with prose

A standalone `**bold line**` followed by descriptive paragraphs renders as a named sub-entry (used in University Service and Professional Service):

```markdown
**Curriculum Committee**
Co-authored major rewrites of undergraduate degree programs. Chaired 2018–2022.
```

#### Date formats

The parser handles a wide range of date strings and normalises them to `year`, `yearEnd`, and `present` fields:

| Markdown date         | Parsed as                       |
| --------------------- | ------------------------------- |
| `2022`                | `{ year: 2022 }`                |
| `2000–2004`           | `{ year: 2000, yearEnd: 2004 }` |
| `2019–24`             | `{ year: 2019, yearEnd: 2024 }` |
| `2004–present`        | `{ year: 2004, present: true }` |
| `Oct 2000 – May 2004` | `{ year: 2000, yearEnd: 2004 }` |

#### Inline formatting

| Markdown       | Renders as     |
| -------------- | -------------- |
| `*italic*`     | _italic_       |
| `**bold**`     | **bold**       |
| `[label](url)` | clickable link |

Bare URLs (e.g. DOI links) are rendered as hyperlinks and shielded from italic/bold processing. External links (`https://`) receive an `↗` icon and open in a new tab.

---

### Format specification — `src/resumeFormats.md`

Defines how many résumés to generate and what each contains. Each top-level `#` heading creates one résumé.

#### Basic structure

```markdown
# Resume Name (output to '/folder/index.html')

- Section Name
- Section Name (instruction)
- Parent Section
  - Child Section (fold instruction)
```

The `(output to '…')` annotation sets the output path relative to the project root. If omitted, a slug derived from the résumé name is used.

#### Including sections

List the sections to include, in the order they should appear. Names must match `##` headings in the CV (case-insensitive). Sub-section names from `###` headings are also resolved automatically — reference `Bibliography` directly without needing to name the parent section.

```markdown
# Artist Resume (output to '/artist/index.html')

- Profile (abbreviated to 100 words and emphasize artistic contributions)
- Selected Exhibitions
- Education
- Curator
- Bibliography
```

#### Transformation instructions

An optional parenthetical after a section name applies a transformation:

| Instruction                      | Effect                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `abbreviated to N words`         | Truncates section prose to approximately N words, breaking at a sentence boundary |
| `integrate X into the flow of Y` | Merges section X entries into section Y, sorted reverse-chronologically by date   |

```markdown
# Professional Resume (output to '/professional/index.html')

- Education
- Professional Experience
  - Professional Service (integrate professional service into the flow of professional experience)
- Scholarship, Publications, and Related Activities
```

When sections are integrated, entries from both sections are merged and sorted newest-first using the `year`, `yearEnd`, and `present` fields parsed from the JSON.

---

## Outputs

### Timeline — `timeline/index.html`

Generated by `json-to-timeline.js`. A fully self-contained HTML page with no external runtime dependencies beyond Google Fonts. All interactivity (expand/collapse, hover labels, detail popup, dark mode) is plain JavaScript embedded in the file. Regenerate whenever the CV changes by running `node src/json-to-timeline.js` after rebuilding the JSON.

### HTML résumés

One per format definition, written to the subfolder specified in `resumeFormats.md`. Each is a fully self-contained HTML file with embedded CSS, a JavaScript light/dark theme toggle, and no external runtime dependencies beyond Google Fonts.

### Landing page — `index.html`

Generated at the project root. Lists every résumé format as a linked row with document icons for PDF and DOCX download. Compatible with GitHub Pages — deploy the root `resumes/` directory as a Pages site and all links resolve correctly.

### Intermediate JSON — `src/Atkinson_CV.json`

Written automatically every time the pipeline runs. Contains the fully parsed CV data (`name`, `contact`, `sections`) and serves as the single intermediate between the Markdown source and all HTML outputs. Do not edit this file directly — it is regenerated from the `.md` on every build.

### PDF exports — `pdf/`

One PDF per résumé, named `Lastname_Formatname.pdf`. Rendered by Chrome headless at A4 size. The output is a pixel-faithful render of the light-mode HTML: correct fonts, layout, and spacing. No browser header, footer, date, or URL watermark.

### DOCX exports — `docx/`

One DOCX per résumé, named `Lastname_Formatname.docx`. Converted by pandoc from a cleaned version of the HTML. Section headings, bullet lists, tables, and inline formatting are preserved as native Word styles. Tables are left-aligned and sized to span the full text column width.
