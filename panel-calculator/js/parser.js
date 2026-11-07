// Heuristic extraction of tilt-panel marks and dimensions from PDF text.
// Works on drawings that contain real text (CAD-exported PDFs). Scanned
// drawings have no text layer - use the AI reader or the measure tool instead.
//
// Input: pages = [{ page: 1, items: [{ str, x, y }] }]
// Output: { panels: [{ mark, qty, width, height, thickness, openings, page, source }], lines }

// Panel marks: P1, P-01, PNL 12, PANEL 3A, TP4, WP-07, EP2, IP-3
const MARK_RE = /\b(P|PNL|PANEL|TP|WP|EP|IP|TU|WALL)\s*[-_.]?\s*(\d{1,3}[A-Z]?)\b/gi;
// "6000 x 3200", "6,000 X 3,200", "6.000 × 3.200" (metres), "6000W x 3200H"
const MARK_TEST = new RegExp(MARK_RE.source, "i");
const PAIR_RE = /(\d{1,2}[,\s]?\d{3}(?:\.\d+)?|\d{1,2}\.\d{1,3}|\d{3,5})\s*(?:mm|m|W)?\s*[xX×*]\s*(\d{1,2}[,\s]?\d{3}(?:\.\d+)?|\d{1,2}\.\d{1,3}|\d{3,5})\s*(?:mm|m|H)?/g;
const NUM_RE = /(?<![\w.])(\d{1,2},\d{3}|\d+(?:\.\d+)?)(?![\w.])/g;
const QTY_RE = /(?:\bqty\.?\s*[:=]?\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:off|no\.?|nos|pcs|panels?)\b|\(\s*x\s*(\d{1,3})\s*\))/i;
const OPENING_RE = /\b(?:opening|door|window|pen(?:etration)?|rsd|roller\s*door|pa\s*door|op)\b[^0-9]{0,12}(\d{3,5})\s*[xX×*]\s*(\d{3,5})/gi;

/** Group positioned text items into reading-order lines. */
export function groupLines(items, tolerance = 3) {
  const sorted = [...items].filter((i) => i.str && i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    let line = lines.find((l) => Math.abs(l.y - it.y) <= tolerance);
    if (!line) {
      line = { y: it.y, items: [] };
      lines.push(line);
    }
    line.items.push(it);
  }
  return lines
    .map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      return { y: l.y, text: l.items.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ") };
    })
    .sort((a, b) => b.y - a.y);
}

function toMm(raw) {
  const s = String(raw).replace(/[,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  // Values like 6.4 / 12.25 are metres; whole numbers >= 100 are mm.
  if (n > 0 && n < 50 && /\./.test(s)) return Math.round(n * 1000);
  return n;
}

function normaliseMark(prefix, num) {
  const p = prefix.toUpperCase();
  const base = p === "PANEL" || p === "PNL" ? "P" : p;
  const digits = num.toUpperCase().replace(/^0+(?=\d)/, "");
  return `${base}${digits}`;
}

const plausibleSide = (mm) => mm >= 300 && mm <= 30000;

/** Pull width/height/thickness out of the text that follows a mark. */
export function dimsFromText(text) {
  // Opening callouts ("RSD 4000x4500", "PA DOOR 920x2100") are not panel sizes.
  text = text.replace(OPENING_RE, " ");
  PAIR_RE.lastIndex = 0;
  const pair = PAIR_RE.exec(text);
  if (pair) {
    const a = toMm(pair[1]);
    const b = toMm(pair[2]);
    if (plausibleSide(a) && plausibleSide(b)) {
      const rest = text.slice(0, pair.index) + " " + text.slice(pair.index + pair[0].length);
      return { width: a, height: b, thickness: thicknessFrom(rest) };
    }
  }
  // Schedule rows: "P1  6000  8400  200 ..." -> first two plausible numbers.
  const nums = [...text.matchAll(NUM_RE)].map((m) => toMm(m[1]));
  const sides = nums.filter(plausibleSide);
  if (sides.length >= 2) {
    return { width: sides[0], height: sides[1], thickness: thicknessFrom(text, sides.slice(0, 2)) };
  }
  return null;
}

function thicknessFrom(text, exclude = []) {
  const t = [...text.matchAll(NUM_RE)]
    .map((m) => toMm(m[1]))
    .find((n) => n >= 100 && n <= 400 && !exclude.includes(n));
  return t || null;
}

function openingsFromText(text) {
  const out = [];
  OPENING_RE.lastIndex = 0;
  let m;
  while ((m = OPENING_RE.exec(text))) {
    out.push({ w: Number(m[1]), h: Number(m[2]), count: 1 });
  }
  return out;
}

/** Extract candidate panels from the pages' text. */
export function extractPanels(pages) {
  const byMark = new Map();
  const allLines = [];

  for (const pg of pages) {
    const lines = groupLines(pg.items);
    lines.forEach((l) => allLines.push({ page: pg.page, text: l.text }));

    for (let li = 0; li < lines.length; li++) {
      const text = lines[li].text;
      const marks = [...text.matchAll(MARK_RE)];
      if (!marks.length) continue;

      marks.forEach((m, mi) => {
        const mark = normaliseMark(m[1], m[2]);
        // Text belonging to this mark: up to the next mark on the line.
        const end = mi + 1 < marks.length ? marks[mi + 1].index : text.length;
        let segment = text.slice(m.index + m[0].length, end);
        let dims = dimsFromText(segment);
        // Elevation labels often put the size on the next line ("P12" / "6000 x 8400").
        if (!dims && marks.length === 1 && li + 1 < lines.length && !MARK_TEST.test(lines[li + 1].text)) {
          segment += " " + lines[li + 1].text;
          dims = dimsFromText(lines[li + 1].text);
        }

        const qtyMatch = segment.match(QTY_RE);
        const qty = qtyMatch ? Number(qtyMatch[1] || qtyMatch[2] || qtyMatch[3]) : 1;
        const openings = openingsFromText(segment);

        const existing = byMark.get(mark);
        const candidate = {
          mark,
          qty: qty > 0 ? qty : 1,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          thickness: dims?.thickness ?? null,
          openings,
          page: pg.page,
          source: (m[0] + segment).trim().slice(0, 140),
        };
        // Same mark appears on plans, elevations and schedules: keep the
        // occurrence with the most information.
        if (!existing || score(candidate) > score(existing)) byMark.set(mark, candidate);
        else if (existing && !existing.openings.length && openings.length) existing.openings = openings;
      });
    }
  }

  const panels = [...byMark.values()].sort((a, b) => markSort(a.mark, b.mark));
  return { panels, lines: allLines };
}

function score(p) {
  return (p.width ? 2 : 0) + (p.height ? 2 : 0) + (p.thickness ? 1 : 0) + (p.openings.length ? 1 : 0) + (p.qty > 1 ? 1 : 0);
}

function markSort(a, b) {
  const pa = a.match(/^([A-Z]+)(\d+)(.*)$/) || [a, a, 0, ""];
  const pb = b.match(/^([A-Z]+)(\d+)(.*)$/) || [b, b, 0, ""];
  return pa[1].localeCompare(pb[1]) || Number(pa[2]) - Number(pb[2]) || pa[3].localeCompare(pb[3]);
}
