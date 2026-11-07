# Tilt Panel Patch Calculator

A static web app for quoting **concrete tilt-up panel patching**. Upload the PDF drawings and it
finds how many panels there are and their sizes, then prices the job by **linear metre of edge**,
**square metre of surface**, or **both**. You enter both rates.

## Features

- **PDF upload** (drag and drop). The file stays in the browser unless you use the AI read.
- **Three ways to get the panels:**
  1. **Quick read** (free, instant). Reads the text in CAD-exported PDFs and finds panel marks
     (`P1`, `PNL-02`, `PANEL 3A`, `TP4`…) with their sizes, from schedule rows
     (`P1 6000 8400 200`) or labels (`6000 x 8400`, `6.4 x 9.25` m). It also picks up quantities
     (`2 OFF`, `QTY 3`) and openings (`RSD 4000x4500`, `PA DOOR 920x2100`). When the same mark shows
     up on several sheets it is kept once.
  2. **AI read** (Claude). Sends the PDF to Claude, which reads schedules, elevations, dimension
     strings and openings, and also works on scanned drawings. It needs your own Anthropic API
     key. The key goes only to `api.anthropic.com` and is stored only if you tick *Remember*.
     Rows it isn't sure about are highlighted.
  3. **Measure manually.** A drawing viewer where you set the scale (`1:100`) or calibrate from a
     known dimension, then drag a box over a panel to add it with the measured width × height.
- **Editable panel table**: mark, qty, width, height, thickness, openings (`1200x2100, 2@900x900`).
- **Pricing options**
  - Turn on per-lm and/or per-m² charging, each with its own rate.
  - Choose which edges count: top, bottom, both sides, opening edges.
  - One face or both faces, with or without deducting openings from the area.
  - Minimum job charge, and GST (10% by default).
- **Quote summary**: panel count, total lm, total m², cost breakdown, subtotal, GST and total.
  It can be printed or saved as a PDF quote, or exported to CSV.
- Saves automatically in the browser (rates are kept between jobs).

## How it calculates

For each panel (W × H mm, quantity Q):

- Edge lm = (top W + bottom W + 2H for the sides + opening perimeters, using the edges you ticked) ÷ 1000 × Q
- Area m² = (W × H − openings if deducted) × faces ÷ 1,000,000 × Q
- Cost = edge lm × linear rate (if on) + area m² × area rate (if on)

## Run locally

No build step. Serve the folder with any static server:

```bash
cd panel-calculator
npm start            # or: python3 -m http.server 5173
# open http://localhost:5173
npm test             # unit tests for the pricing maths and the PDF text parser
```

## Deploy

It's plain static files (`index.html`, `styles.css`, `js/`), so it can be hosted on Vercel, Netlify,
GitHub Pages or S3. On Vercel, create a project with **Root Directory** `panel-calculator` and no
framework preset or build command.

Third-party code loads from jsdelivr: `pdfjs-dist@5.7.284` (PDF rendering and text) and
`@anthropic-ai/sdk@0.137.0` (only loaded when the AI read is used).

## Limits

- Quick read depends on the drawing having real text and the usual mark/size layouts. Always check
  the table against the drawings.
- The AI read takes PDFs up to about 30 MB per request. Split large sets, or upload only the panel
  sheets.
- Measuring assumes one scale per page. Recalibrate when you move to a page drawn at a different scale.
