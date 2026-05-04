# Resume Builder

A single-source résumé pipeline. One Markdown CV file and one format specification produce as many tailored HTML résumés as you need, each automatically exported to PDF and DOCX. The root `index.html` is a GitHub Pages–compatible landing page that links to every format.

---

## Requirements

| Tool                                            | Purpose              | Install                         |
| ----------------------------------------------- | -------------------- | ------------------------------- |
| [Node.js](https://nodejs.org/) 16+              | Runs all scripts              | `brew install node`             |
| [pandoc](https://pandoc.org/)                   | Generates DOCX files          | `brew install pandoc`           |
| [Google Chrome](https://www.google.com/chrome/) | Generates PDF files           | Download from google.com/chrome |
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
├── pdf/                    ← PDF exports
├── docx/                   ← DOCX exports
└── src/
    ├── Atkinson_CV.md      ← Source CV (edit this)
    ├── resumeFormats.md    ← Format definitions (edit this)
    ├── md-to-resume.js     ← Core HTML renderer
    ├── md-to-resumes.js    ← Pipeline orchestrator
    ├── html-to-exports.js  ← PDF + DOCX exporter
    └── table-fix.lua       ← Pandoc filter for DOCX table layout
```

---

## Usage

Run the full pipeline from the project root:

```bash
node src/md-to-resumes.js src/Atkinson_CV.md
```

An optional second argument overrides the format spec path:

```bash
node src/md-to-resumes.js src/Atkinson_CV.md src/resumeFormats.md
```

This single command regenerates all HTML résumés, the landing page, all PDFs, and all DOCX files.

---

## How it works

### `src/md-to-resume.js` — Core HTML renderer

Parses a Markdown CV and produces a self-contained, styled HTML page. Handles all content types: tables, bullet lists, professional experience entries (bold title — italic date), bold sub-headings with prose, inline formatting, and external links.

Used as a library by the pipeline (`parseMarkdown`, `buildHTML`) and also works standalone:

```bash
node src/md-to-resume.js src/Atkinson_CV.md          # → Atkinson_CV.html
node src/md-to-resume.js src/Atkinson_CV.md out.html  # custom filename
```

The standalone output is written to the project root and to `~/Desktop/Job Applications/CVs/resumé updater/` if that folder exists.

---

### `src/md-to-resumes.js` — Pipeline orchestrator

Reads `resumeFormats.md` and generates one tailored HTML résumé per format definition. For each format it:

1. Selects only the specified sections from the CV
2. Applies any transformations described in the format spec (abbreviation, section merging)
3. Writes the result to the output folder defined in the spec (e.g. `artist/index.html`)

After all résumés are written it builds `index.html` at the project root and then invokes `html-to-exports.js` to produce the PDF and DOCX files.

---

### `src/html-to-exports.js` — PDF and DOCX exporter

Reads each HTML résumé listed in `resumeFormats.md` and converts it to two formats:

**PDF** — uses Chrome headless (`--print-to-pdf`). The full CSS is preserved so the PDF matches the browser rendering exactly. Page size is A4 with 0.75 in top, 1 in bottom, and 2.5 cm side margins applied on every page. Headers and footers (date, filename, file path) are suppressed.

**DOCX** — uses pandoc. Before conversion, browser-only elements (stylesheets, scripts, theme toggle) are stripped and `div`-based section headings are promoted to semantic `<h2>`/`<h3>` elements so pandoc builds a correctly structured document. The `table-fix.lua` filter sets proportional column widths and left-alignment on all tables so they span the full text column rather than collapsing to minimum width.

Output files are named `Lastname_Formatname.pdf` / `.docx` (e.g. `Atkinson_Artist.pdf`).

---

### `src/table-fix.lua` — Pandoc table filter

A Lua filter that runs during DOCX generation. It intercepts every table in the pandoc AST and sets left-alignment and proportional column widths before the document is rendered. The width distribution favours a wide last column (dates → 18 %, codes/institutions → 27 %, titles/descriptions → 55 %), preventing table content from overflowing the page margins.

---

## Input files

### CV source — `src/Atkinson_CV.md`

The single source of truth for all résumé content. Follows a specific Markdown structure.

#### Header block

The first line must be the name as an H1. Contact fields follow immediately — one per line. Supported labels: `Email`, `Tel`, `Phone`, `Website`, `Web`, `LinkedIn`. Values may be plain text or Markdown links. LinkedIn links are detected automatically and rendered with the LinkedIn logo in HTML.

```markdown
# Your Name

Email: [you@example.com](mailto:you@example.com)
Tel: [212 000 0000](tel:2120000000)
Website: [yoursite.com](https://yoursite.com)
LinkedIn: [yourhandle](https://www.linkedin.com/in/yourhandle/)
```

#### Profile / bio

Paragraphs between the contact block and the first `##` heading (or `---` divider) become the Profile section:

```markdown
Your profile text here as one or more plain paragraphs.
```

#### Sections

`##` headings define CV sections. The heading text becomes the left-column label in the HTML layout.

```markdown
## Education

## Professional Experience

## Selected Exhibitions
```

#### Sub-sections

`###` headings create labelled sub-groups within a section (e.g. courses grouped by discipline):

```markdown
## Classes Taught

### Photography

### Creative Coding
```

#### Tables

Markdown tables render as clean, proportionally-sized tables. The first column is displayed in muted grey (suited to years or dates):

```markdown
| Dates     | Institution                       | Qualification      |
| --------- | --------------------------------- | ------------------ |
| 2000–2004 | University of the West of England | Ph.D.              |
| 1993–1996 | University of the West of England | BA (hons) Fine Art |
```

#### Professional experience entries

`**bold** — _italic_` pairs render as title–date entries. Bullet points immediately below become description lines:

```markdown
**Montclair State University, Montclair, NJ** — _2004–present_

- Assistant Professor of Digital Photography
- Director of the MFA in Studio Arts, 2009–2017
```

#### Bullet lists

Standard Markdown bullets render as a clean list. A leading year pattern (`2022 —`) is automatically styled in muted grey:

```markdown
- 2022 — Exhibition title, Venue, City
- 2021 — Another exhibition, Venue, City
```

#### Bold sub-headings with prose

A standalone `**bold line**` followed by one or more paragraphs renders as a named sub-entry:

```markdown
**Curriculum Committee**
Co-authored major rewrites of undergraduate degree programs. Chaired 2018–2022.
```

#### Inline formatting

| Markdown       | Renders as     |
| -------------- | -------------- |
| `*italic*`     | _italic_       |
| `**bold**`     | **bold**       |
| `[label](url)` | clickable link |

Bare URLs (e.g. DOI links) are rendered as hyperlinks and shielded from italic/bold processing.

---

### Format specification — `src/resumeFormats.md`

Defines how many résumés to generate and what each one contains. Each top-level `#` heading creates one résumé.

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

List the sections to include, in the order they should appear. Section names must match `##` headings in the CV (case-insensitive). Sub-section names (from `###` headings) are also resolved automatically.

```markdown
# Artist Resume (output to '/artist/index.html')

- Profile
- Selected Exhibitions
- Education
- Bibliography
```

#### Instructions

An optional parenthetical after a section name applies a transformation:

| Instruction                      | Effect                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `abbreviated to N words and …`   | Truncates the section prose to approximately N words, breaking at a sentence boundary |
| `integrate X into the flow of Y` | Merges section X into section Y in reverse chronological order by date                |

```markdown
- Profile (abbreviated to 100 words and emphasize artistic contributions)
- Professional Experience
  - Professional Service (integrate professional service into the flow of professional experience)
```

When sections are integrated, entries from both sections are merged and sorted newest-first by the year references found in each entry.

---

## Outputs

### HTML résumés

One per format definition, written to the subfolder specified in `resumeFormats.md`. Each is a fully self-contained HTML file with embedded CSS, JavaScript theme toggle (light/dark mode), and no external runtime dependencies beyond Google Fonts.

### Landing page — `index.html`

Generated at the project root. Lists every résumé format as a linked row. Each row includes a document icon linking to the PDF download and a second icon linking to the DOCX download. Inherits the same typographic design tokens as the résumés.

### PDF exports — `pdf/`

One PDF per résumé, named `Lastname_Formatname.pdf`. Rendered by Chrome headless at A4 size. The output is a pixel-faithful render of the light-mode HTML: correct fonts, layout, and spacing. No browser header, footer, date, or URL watermark.

### DOCX exports — `docx/`

One DOCX per résumé, named `Lastname_Formatname.docx`. Converted by pandoc from a cleaned version of the HTML. Section headings, bullet lists, tables, and inline formatting are preserved as native Word styles. Tables are left-aligned and sized to span the full text column width.
