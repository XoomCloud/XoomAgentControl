// Pure pricing maths for concrete tilt-panel patching.
// All panel dimensions are in millimetres; results are in metres / m².

/** Parse an openings string such as "1200x2100, 2@900x900" into [{w,h,count}]. */
export function parseOpenings(text) {
  if (!text) return [];
  return String(text)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(?:(\d+)\s*@\s*)?(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i);
      if (!m) return null;
      return { count: m[1] ? Number(m[1]) : 1, w: Number(m[2]), h: Number(m[3]) };
    })
    .filter((o) => o && o.w > 0 && o.h > 0 && o.count > 0);
}

/** Format openings back into the editable string form. */
export function formatOpenings(openings) {
  return (openings || [])
    .map((o) => `${o.count > 1 ? `${o.count}@` : ""}${round(o.w, 0)}x${round(o.h, 0)}`)
    .join(", ");
}

export const DEFAULT_SETTINGS = {
  chargeLinear: true,
  chargeArea: true,
  linearRate: 0, // $ per linear metre of edge
  areaRate: 0, // $ per m² of surface
  edgeTop: true,
  edgeBottom: true,
  edgeSides: true,
  edgeOpenings: true,
  faces: 1, // 1 = one face patched, 2 = both faces
  deductOpenings: true,
  minimumCharge: 0,
  gst: true,
  gstRate: 10,
};

/** Measurements for a single panel (one unit, not multiplied by qty). */
export function measurePanel(panel, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const W = Number(panel.width) || 0;
  const H = Number(panel.height) || 0;
  const openings = Array.isArray(panel.openings) ? panel.openings : parseOpenings(panel.openings);

  let edgeMm = 0;
  if (s.edgeTop) edgeMm += W;
  if (s.edgeBottom) edgeMm += W;
  if (s.edgeSides) edgeMm += 2 * H;
  let openingPerimMm = 0;
  let openingAreaMm2 = 0;
  for (const o of openings) {
    openingPerimMm += 2 * (o.w + o.h) * o.count;
    openingAreaMm2 += o.w * o.h * o.count;
  }
  if (s.edgeOpenings) edgeMm += openingPerimMm;

  const grossAreaMm2 = W * H;
  const netAreaMm2 = Math.max(0, grossAreaMm2 - (s.deductOpenings ? openingAreaMm2 : 0));
  const faces = Number(s.faces) === 2 ? 2 : 1;

  return {
    linearM: edgeMm / 1000,
    areaM2: (netAreaMm2 * faces) / 1e6,
    grossAreaM2: grossAreaMm2 / 1e6,
    openingCount: openings.reduce((n, o) => n + o.count, 0),
  };
}

/** Full job quote. */
export function quote(panels, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const linearRate = Number(s.linearRate) || 0;
  const areaRate = Number(s.areaRate) || 0;

  const lines = panels.map((p) => {
    const qty = Math.max(0, Math.round(Number(p.qty) || 0));
    const m = measurePanel(p, s);
    const linearM = m.linearM * qty;
    const areaM2 = m.areaM2 * qty;
    const linearCost = s.chargeLinear ? linearM * linearRate : 0;
    const areaCost = s.chargeArea ? areaM2 * areaRate : 0;
    return {
      ...p,
      qty,
      unitLinearM: m.linearM,
      unitAreaM2: m.areaM2,
      linearM,
      areaM2,
      linearCost,
      areaCost,
      total: linearCost + areaCost,
    };
  });

  const panelCount = lines.reduce((n, l) => n + l.qty, 0);
  const totalLinearM = lines.reduce((n, l) => n + l.linearM, 0);
  const totalAreaM2 = lines.reduce((n, l) => n + l.areaM2, 0);
  const linearCost = lines.reduce((n, l) => n + l.linearCost, 0);
  const areaCost = lines.reduce((n, l) => n + l.areaCost, 0);
  const work = linearCost + areaCost;
  const minimum = Number(s.minimumCharge) || 0;
  const minimumApplied = panelCount > 0 && minimum > work;
  const subtotal = minimumApplied ? minimum : work;
  const gst = s.gst ? subtotal * ((Number(s.gstRate) || 0) / 100) : 0;

  return {
    lines,
    panelCount,
    totalLinearM,
    totalAreaM2,
    linearCost,
    areaCost,
    minimumApplied,
    subtotal,
    gst,
    total: subtotal + gst,
  };
}

export function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}
