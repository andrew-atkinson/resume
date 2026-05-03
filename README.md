# CV Tools

This folder contains Andrew Atkinson's CV source files and the script that converts them to a styled HTML document.

---

## md-to-resume.js

Converts a Markdown CV file into a self-contained HTML page using the same typographic style as `andrew_atkinson_resume.html`. No external dependencies — pure Node.js.

The generated HTML is written to **two places automatically**:
- `~/resumes/` (this folder)
- `~/Desktop/Job Applications/CVs/resumé updater/`

### Usage

```bash
# From the resumes folder:
node md-to-resume.js Atkinson_CV.md

# Custom output filename:
node md-to-resume.js Atkinson_CV.md my-output.html
```

The output filename defaults to the input filename with `.html` substituted for `.md`.

---

## How to format the input Markdown file

The script expects a specific structure. Follow the template below.

### Header block

The very first line must be the name as an H1. Contact fields follow immediately — one per line. Supported field labels: `Email`, `Tel`, `Phone`, `Website`, `Web`, `LinkedIn`. Values can be plain text or Markdown links.

```markdown
# Your Name

Email: [you@example.com](mailto:you@example.com)
Tel: [212 000 0000](tel:2120000000)
Website: [yoursite.com](http://yoursite.com)
LinkedIn: [yourhandle](https://www.linkedin.com/in/yourhandle/)
```

LinkedIn links are detected automatically and rendered with the LinkedIn logo.

### Bio / profile

Any paragraphs after the contact block (before the first `---` or `##` heading) become the **Profile** section:

```markdown
Your bio text goes here as one or more plain paragraphs.

A second paragraph is fine too.

---
```

### Sections

Use `##` headings for each CV section. The heading text becomes the left-column label.

```markdown
## Education
## Professional Experience
## Selected Exhibitions
## Grants
```

### Sub-headings within a section

Use `###` for category labels inside a section (e.g. grouping courses by discipline):

```markdown
## Classes Taught

### Photography
...

### Creative Coding
...
```

### Tables

Markdown tables render as clean HTML tables. The first column is displayed in muted grey (good for years/dates):

```markdown
| Dates       | Institution                        | Qualification       |
|-------------|-------------------------------------|---------------------|
| 2000 – 2004 | University of the West of England   | Ph.D.               |
| 1993 – 1996 | University of the West of England   | BA (hons) Fine Art  |
```

### Professional experience entries

Use `**bold** — *italic*` for title–date pairs. Bullet points directly below become description lines:

```markdown
**Montclair State University, Montclair, NJ** — *2004–present*
- Assistant Professor of Digital Photography
- Director of the MFA in Studio Arts, 2009–2017
```

### Bullet lists

Standard Markdown bullets render as a clean dash list:

```markdown
- 2022 — Exhibition name, Venue, City
- 2021 — Another exhibition, Venue, City
```

### Bold sub-headings with prose

A standalone `**bold line**` followed by a paragraph renders as a named sub-entry (used in University Service):

```markdown
**Curriculum Committee**
Co-authored major rewrites of undergraduate degree programs. Chaired committee 2018–2022.
```

### Inline formatting

| Markdown | Output |
|----------|--------|
| `*italic*` | *italic* |
| `**bold**` | **bold** |
| `[label](url)` | clickable link |

Bare URLs (e.g. DOI links) are rendered as plain text and protected from italic/bold processing.
