import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.min.mjs";
import { DEFAULT_SETTINGS, quote, parseOpenings, formatOpenings, round } from "./calc.js";
import { extractPanels } from "./parser.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs";

const STORE_KEY = "tilt-patch-calc:v1";
const KEY_STORE = "tilt-patch-calc:anthropic-key";
const MM_PER_PT = 25.4 / 72;
const MAX_AI_BYTES = 30 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const num = (n, dp = 2) => (Number(n) || 0).toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
let nextId = 1;
const uid = () => `p${Date.now().toString(36)}${(nextId++).toString(36)}`;

// ---------------------------------------------------------------- state
const state = load() || {
  job: { client: "", name: "", quote: "", date: new Date().toISOString().slice(0, 10) },
  settings: { ...DEFAULT_SETTINGS },
  panels: [],
};
state.settings = { ...DEFAULT_SETTINGS, ...state.settings };

const doc = { file: null, bytes: null, pdf: null, pages: [], page: 1, zoom: 1, mmPerPt: null };

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable - app still works for this session */
    }
  }, 250);
}

function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

function setStatus(msg, kind = "") {
  const el = $("file-status");
  el.hidden = !msg;
  el.className = `status ${kind}`;
  el.textContent = msg || "";
}

// ---------------------------------------------------------------- job + settings binding
const jobFields = { "job-client": "client", "job-name": "name", "job-quote": "quote", "job-date": "date" };
for (const [id, key] of Object.entries(jobFields)) {
  const el = $(id);
  el.value = state.job[key] || "";
  el.addEventListener("input", () => {
    state.job[key] = el.value;
    save();
  });
}

const checkSettings = {
  "charge-linear": "chargeLinear",
  "charge-area": "chargeArea",
  "edge-top": "edgeTop",
  "edge-bottom": "edgeBottom",
  "edge-sides": "edgeSides",
  "edge-openings": "edgeOpenings",
  "deduct-openings": "deductOpenings",
  gst: "gst",
};
const valueSettings = {
  "linear-rate": "linearRate",
  "area-rate": "areaRate",
  "minimum-charge": "minimumCharge",
  "gst-rate": "gstRate",
  faces: "faces",
};
for (const [id, key] of Object.entries(checkSettings)) {
  const el = $(id);
  el.checked = !!state.settings[key];
  el.addEventListener("change", () => {
    state.settings[key] = el.checked;
    onSettingsChanged();
  });
}
for (const [id, key] of Object.entries(valueSettings)) {
  const el = $(id);
  el.value = state.settings[key] || (key === "faces" ? "1" : "");
  el.addEventListener("input", () => {
    state.settings[key] = el.value === "" ? 0 : Number(el.value);
    onSettingsChanged();
  });
}

function onSettingsChanged() {
  const s = state.settings;
  $("rate-linear-box").classList.toggle("off", !s.chargeLinear);
  $("rate-area-box").classList.toggle("off", !s.chargeArea);
  $("rate-warning").hidden = s.chargeLinear || s.chargeArea;
  $("gst-rate").disabled = !s.gst;
  const table = $("panel-table");
  table.classList.toggle("hide-linear", !s.chargeLinear);
  table.classList.toggle("hide-area", !s.chargeArea);
  updateCalcs();
  save();
}

// ---------------------------------------------------------------- panels table
function blankPanel(extra = {}) {
  return { id: uid(), mark: "", qty: 1, width: "", height: "", thickness: "", openings: "", source: "", page: null, confidence: "", ...extra };
}

function normalisePanel(p) {
  return blankPanel({
    mark: p.mark || "",
    qty: p.qty || 1,
    width: p.width ?? "",
    height: p.height ?? "",
    thickness: p.thickness ?? "",
    openings: Array.isArray(p.openings) ? formatOpenings(p.openings) : p.openings || "",
    source: p.source || "",
    page: p.page ?? null,
    confidence: p.confidence || "",
    rect: p.rect || null,
  });
}

function cell(inner, cls = "") {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  if (typeof inner === "string") td.innerHTML = inner;
  else if (inner) td.append(inner);
  return td;
}

function input(panel, field, cls, type = "text") {
  const el = document.createElement("input");
  el.type = type;
  el.className = cls;
  el.value = panel[field] ?? "";
  if (type === "number") {
    el.min = "0";
    el.inputMode = "decimal";
  }
  el.setAttribute("aria-label", field);
  el.addEventListener("input", () => {
    panel[field] = type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
    if (field === "openings") el.classList.toggle("invalid", !openingsValid(el.value));
    if (field === "width" || field === "height") panel.confidence = panel.confidence === "low" ? "edited" : panel.confidence;
    updateCalcs();
    save();
  });
  return el;
}

function openingsValid(text) {
  const parts = String(text).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  return parts.length === parseOpenings(text).length;
}

function renderTable() {
  const body = $("panel-body");
  body.innerHTML = "";
  for (const p of state.panels) {
    const tr = document.createElement("tr");
    tr.dataset.id = p.id;
    if (p.confidence === "low" || !p.width || !p.height) tr.classList.add("low");

    const markTd = cell(input(p, "mark", "mark"));
    if (p.source) {
      const src = document.createElement("span");
      src.className = "src";
      src.title = p.source;
      src.textContent = `${p.page ? `p${p.page}: ` : ""}${p.source}`;
      markTd.append(src);
    }
    tr.append(
      markTd,
      cell(input(p, "qty", "qty num", "number"), "num"),
      cell(input(p, "width", "dim num", "number"), "num"),
      cell(input(p, "height", "dim num", "number"), "num"),
      cell(input(p, "thickness", "thk num", "number"), "num"),
      cell(input(p, "openings", "open")),
      cell("", "num calc col-linear c-lm"),
      cell("", "num calc col-area c-m2"),
      cell("", "num col-linear c-lcost"),
      cell("", "num col-area c-acost"),
      cell("", "num total-cell c-total"),
    );
    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon-btn";
    del.title = "Remove panel";
    del.setAttribute("aria-label", `Remove panel ${p.mark}`);
    del.textContent = "✕";
    del.addEventListener("click", () => {
      state.panels = state.panels.filter((x) => x.id !== p.id);
      renderTable();
      save();
    });
    tr.append(cell(del, "no-print"));
    body.append(tr);
  }
  $("empty-state").hidden = state.panels.length > 0;
  updateCalcs();
  drawOverlay();
}

function updateCalcs() {
  const s = state.settings;
  const q = quote(state.panels, s);
  const rows = $("panel-body").children;
  q.lines.forEach((l, i) => {
    const tr = rows[i];
    if (!tr) return;
    tr.querySelector(".c-lm").textContent = num(l.linearM);
    tr.querySelector(".c-m2").textContent = num(l.areaM2);
    tr.querySelector(".c-lcost").textContent = money.format(l.linearCost);
    tr.querySelector(".c-acost").textContent = money.format(l.areaCost);
    tr.querySelector(".c-total").textContent = money.format(l.total);
    tr.classList.toggle("low", l.confidence === "low" || !l.width || !l.height);
  });

  $("panel-count-badge").textContent = q.panelCount;
  $("s-panels").textContent = q.panelCount;
  $("s-linear").textContent = `${num(q.totalLinearM, 1)} lm`;
  $("s-area").textContent = `${num(q.totalAreaM2, 1)} m²`;
  $("t-linear-row").hidden = !s.chargeLinear;
  $("t-area-row").hidden = !s.chargeArea;
  $("t-linear-label").textContent = `Edge patching - ${num(q.totalLinearM, 1)} lm @ ${money.format(s.linearRate || 0)}`;
  $("t-area-label").textContent = `Surface patching - ${num(q.totalAreaM2, 1)} m² @ ${money.format(s.areaRate || 0)}`;
  $("t-linear").textContent = money.format(q.linearCost);
  $("t-area").textContent = money.format(q.areaCost);
  $("t-min-row").hidden = !q.minimumApplied;
  $("t-sub").textContent = money.format(q.subtotal);
  $("t-gst-row").hidden = !s.gst;
  $("t-gst-label").textContent = `GST (${s.gstRate || 0}%)`;
  $("t-gst").textContent = money.format(q.gst);
  $("t-total").textContent = money.format(q.total);
  return q;
}

function addPanels(found, label) {
  if (!found.length) return;
  let replace = false;
  if (state.panels.length) {
    replace = confirm(
      `Found ${found.length} panel marks (${label}).\n\nOK = replace the ${state.panels.length} panels already in the table\nCancel = add them to the table`,
    );
  }
  const fresh = found.map(normalisePanel);
  state.panels = replace ? fresh : [...state.panels, ...fresh];
  renderTable();
  save();
  $("panel-table").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("btn-add").addEventListener("click", () => {
  state.panels.push(blankPanel({ mark: `P${state.panels.length + 1}` }));
  renderTable();
  save();
  $("panel-body").lastElementChild?.querySelector("input.dim")?.focus();
});
$("btn-clear").addEventListener("click", () => {
  if (state.panels.length && confirm("Remove all panels from the table?")) {
    state.panels = [];
    renderTable();
    save();
  }
});
$("btn-new-job").addEventListener("click", () => {
  if (!confirm("Start a new job? Panels and job details are cleared; your rates are kept.")) return;
  state.panels = [];
  state.job = { client: "", name: "", quote: "", date: new Date().toISOString().slice(0, 10) };
  for (const [id, key] of Object.entries(jobFields)) $(id).value = state.job[key];
  renderTable();
  save();
});

// ---------------------------------------------------------------- PDF upload
const dz = $("dropzone");
const fileInput = $("file-input");
dz.addEventListener("click", () => fileInput.click());
dz.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
dz.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("drag");
});
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("drag");
  const f = e.dataTransfer.files?.[0];
  if (f) openFile(f);
});
fileInput.addEventListener("change", () => fileInput.files[0] && openFile(fileInput.files[0]));

async function openFile(file) {
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
    setStatus("Please choose a PDF file.", "error");
    return;
  }
  setStatus(`Opening ${file.name}…`, "busy");
  try {
    doc.file = file;
    doc.bytes = new Uint8Array(await file.arrayBuffer());
    doc.pdf = await pdfjsLib.getDocument({ data: doc.bytes.slice() }).promise;
    doc.pages = [];
    let textItems = 0;
    for (let i = 1; i <= doc.pdf.numPages; i++) {
      setStatus(`Reading text on page ${i} of ${doc.pdf.numPages}…`, "busy");
      const page = await doc.pdf.getPage(i);
      const tc = await page.getTextContent();
      const items = tc.items
        .filter((it) => "str" in it)
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
      textItems += items.length;
      doc.pages.push({ page: i, items });
    }
    doc.page = 1;
    doc.textItems = textItems;
    const mb = (file.size / 1024 / 1024).toFixed(1);
    const scanned = textItems < doc.pdf.numPages * 5;
    setStatus(
      `${file.name} - ${doc.pdf.numPages} page${doc.pdf.numPages > 1 ? "s" : ""}, ${mb} MB.` +
        (scanned ? " This looks like a scanned drawing (little or no text) - use the AI read or measure manually." : " Choose how to find the panels below."),
    );
    $("detect-actions").hidden = false;
    $("ai-notes").hidden = true;
    if (!scanned) runQuickRead(true);
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't open that PDF: ${err.message || err}`, "error");
  }
}

function runQuickRead(auto = false) {
  if (!doc.pages.length) return;
  const { panels } = extractPanels(doc.pages);
  if (!panels.length) {
    if (!auto) toast("No panel marks found in the text. Try the AI read or measure manually.", 4000);
    else setStatus(`${$("file-status").textContent} Quick read found no panel marks - try the AI read.`);
    return;
  }
  const withDims = panels.filter((p) => p.width && p.height).length;
  toast(`Quick read: ${panels.length} panel marks, ${withDims} with sizes. Check them in the table.`, 4500);
  addPanels(panels, "quick read");
}
$("btn-quick").addEventListener("click", () => runQuickRead(false));

// ---------------------------------------------------------------- AI read
const keyInput = $("api-key");
const rememberKey = $("remember-key");
try {
  const k = localStorage.getItem(KEY_STORE);
  if (k) {
    keyInput.value = k;
    rememberKey.checked = true;
  }
} catch {
  /* ignore */
}
function persistKey() {
  try {
    if (rememberKey.checked && keyInput.value) localStorage.setItem(KEY_STORE, keyInput.value.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
}
rememberKey.addEventListener("change", persistKey);
keyInput.addEventListener("change", persistKey);

function bytesToBase64(bytes) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([bytes], { type: "application/pdf" }));
  });
}

$("btn-ai").addEventListener("click", async () => {
  if (!doc.bytes) return toast("Upload a PDF first.");
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    keyInput.focus();
    return toast("Enter your Anthropic API key to use the AI read.");
  }
  if (doc.bytes.byteLength > MAX_AI_BYTES) {
    return setStatus("This PDF is over 30 MB - the AI reader can't take it in one go. Split the set or upload only the panel sheets.", "error");
  }
  persistKey();
  const btn = $("btn-ai");
  btn.disabled = true;
  setStatus("Loading AI reader…", "busy");
  try {
    const ai = await import("./ai.js");
    try {
      const pdfBase64 = await bytesToBase64(doc.bytes);
      const { panels, notes } = await ai.readDrawingWithClaude({
        apiKey,
        pdfBase64,
        onProgress: (m) => setStatus(m, "busy"),
      });
      const low = panels.filter((p) => p.confidence === "low").length;
      setStatus(`AI read complete: ${panels.length} panel marks${low ? `, ${low} flagged low confidence (highlighted)` : ""}.`);
      const notesEl = $("ai-notes");
      notesEl.hidden = !notes;
      notesEl.textContent = notes ? `Notes from the AI read:\n${notes}` : "";
      if (panels.length) addPanels(panels, "AI read");
      else toast("The AI read didn't find any panels in this drawing.", 4000);
    } catch (err) {
      console.error(err);
      setStatus(ai.describeError(err), "error");
    }
  } catch (err) {
    console.error(err);
    setStatus("Couldn't load the AI reader - check your internet connection.", "error");
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- viewer + measuring
const pdfCanvas = $("pdf-canvas");
const overlay = $("overlay-canvas");
const octx = overlay.getContext("2d");
let renderScale = 1; // canvas px per PDF point (CSS px)
let tool = null; // "calibrate" | "measure" | "line"
let drag = null;
let calibPts = [];
let renderTask = null;

$("btn-show-viewer").addEventListener("click", async () => {
  if (!doc.pdf) return toast("Upload a PDF first.");
  $("viewer").hidden = false;
  await renderPage();
  $("viewer").scrollIntoView({ behavior: "smooth", block: "start" });
});

async function renderPage() {
  if (!doc.pdf) return;
  const page = await doc.pdf.getPage(doc.page);
  const base = page.getViewport({ scale: 1 });
  const fit = Math.min(1.6, (($("viewer").clientWidth || 900) - 30) / base.width);
  renderScale = fit * doc.zoom;
  const vp = page.getViewport({ scale: renderScale });
  const dpr = window.devicePixelRatio || 1;
  for (const c of [pdfCanvas, overlay]) {
    c.width = Math.floor(vp.width * dpr);
    c.height = Math.floor(vp.height * dpr);
    c.style.width = `${Math.floor(vp.width)}px`;
    c.style.height = `${Math.floor(vp.height)}px`;
  }
  renderTask?.cancel();
  renderTask = page.render({
    canvas: pdfCanvas,
    canvasContext: pdfCanvas.getContext("2d"),
    viewport: vp,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  });
  try {
    await renderTask.promise;
  } catch (e) {
    if (e?.name !== "RenderingCancelledException") throw e;
  }
  $("pg-label").textContent = `Page ${doc.page} / ${doc.pdf.numPages}`;
  $("zoom-label").textContent = `${Math.round(doc.zoom * 100)}%`;
  drawOverlay();
}

$("pg-prev").addEventListener("click", () => {
  if (doc.page > 1) {
    doc.page--;
    renderPage();
  }
});
$("pg-next").addEventListener("click", () => {
  if (doc.pdf && doc.page < doc.pdf.numPages) {
    doc.page++;
    renderPage();
  }
});
$("zoom-in").addEventListener("click", () => {
  doc.zoom = Math.min(6, doc.zoom * 1.25);
  renderPage();
});
$("zoom-out").addEventListener("click", () => {
  doc.zoom = Math.max(0.3, doc.zoom / 1.25);
  renderPage();
});

$("scale-denom").addEventListener("input", (e) => {
  const n = Number(e.target.value);
  doc.mmPerPt = n > 0 ? n * MM_PER_PT : null;
  updateScaleLabel("from drawing scale");
});
function updateScaleLabel(how) {
  $("scale-label").textContent = doc.mmPerPt ? `≈1:${Math.round(doc.mmPerPt / MM_PER_PT)} (${how})` : "No scale set";
}

function setTool(t) {
  tool = tool === t ? null : t;
  calibPts = [];
  drag = null;
  $("tool-calibrate").classList.toggle("active", tool === "calibrate");
  $("tool-measure").classList.toggle("active", tool === "measure");
  $("tool-line").classList.toggle("active", tool === "line");
  overlay.classList.toggle("tool-on", !!tool);
  const hints = {
    calibrate: "Calibrate: click the two ends of a dimension you know (e.g. a dimension string), then enter its real length.",
    measure: "Measure panel: drag a box from one corner of the panel to the opposite corner.",
    line: "Measure line: drag along any edge to read its length.",
  };
  $("viewer-hint").textContent = tool ? hints[tool] : "Choose a tool above. Scroll to pan.";
  if ((tool === "measure" || tool === "line") && !doc.mmPerPt) toast("Set the drawing scale or calibrate first.", 3500);
  drawOverlay();
}
$("tool-calibrate").addEventListener("click", () => setTool("calibrate"));
$("tool-measure").addEventListener("click", () => setTool("measure"));
$("tool-line").addEventListener("click", () => setTool("line"));

function ptFromEvent(e) {
  const r = overlay.getBoundingClientRect();
  return { x: (e.clientX - r.left) / renderScale, y: (e.clientY - r.top) / renderScale };
}

overlay.addEventListener("pointerdown", (e) => {
  if (!tool) return;
  const p = ptFromEvent(e);
  if (tool === "calibrate") {
    calibPts.push(p);
    if (calibPts.length === 2) finishCalibration();
    drawOverlay();
    return;
  }
  overlay.setPointerCapture(e.pointerId);
  drag = { a: p, b: p };
});
overlay.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.b = ptFromEvent(e);
  drawOverlay();
});
overlay.addEventListener("pointerup", (e) => {
  if (!drag) return;
  drag.b = ptFromEvent(e);
  const d = drag;
  drag = null;
  if (!doc.mmPerPt) {
    drawOverlay();
    return toast("Set the drawing scale or calibrate first.", 3500);
  }
  const wPt = Math.abs(d.b.x - d.a.x);
  const hPt = Math.abs(d.b.y - d.a.y);
  if (tool === "line") {
    const len = Math.hypot(wPt, hPt) * doc.mmPerPt;
    toast(`Length ≈ ${Math.round(len).toLocaleString("en-AU")} mm`, 5000);
    drawOverlay();
    return;
  }
  if (wPt < 3 || hPt < 3) return drawOverlay();
  const width = Math.round(wPt * doc.mmPerPt / 10) * 10;
  const height = Math.round(hPt * doc.mmPerPt / 10) * 10;
  const mark = prompt(`Measured panel ≈ ${width} x ${height} mm.\n\nPanel mark (and adjust sizes in the table if needed):`, `P${state.panels.length + 1}`);
  if (mark === null) return drawOverlay();
  state.panels.push(
    blankPanel({
      mark: mark.trim() || `P${state.panels.length + 1}`,
      width,
      height,
      page: doc.page,
      source: "measured on drawing",
      rect: { page: doc.page, x: Math.min(d.a.x, d.b.x), y: Math.min(d.a.y, d.b.y), w: wPt, h: hPt },
    }),
  );
  renderTable();
  save();
  toast(`Added ${mark || "panel"} - ${width} x ${height} mm`);
});

function finishCalibration() {
  const [a, b] = calibPts;
  const lenPt = Math.hypot(b.x - a.x, b.y - a.y);
  calibPts = [];
  if (lenPt < 2) return;
  const real = prompt("Real length of that line in millimetres:", "");
  const mm = Number(String(real || "").replace(/[, ]/g, ""));
  if (mm > 0) {
    doc.mmPerPt = mm / lenPt;
    $("scale-denom").value = Math.round(doc.mmPerPt / MM_PER_PT);
    updateScaleLabel("calibrated");
    toast("Scale calibrated. Now use Measure panel.");
    setTool("measure");
  }
}

function drawOverlay() {
  if ($("viewer").hidden) return;
  const dpr = window.devicePixelRatio || 1;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const S = renderScale;
  const accent = "#d9661f";
  octx.lineWidth = 2;
  octx.font = "600 12px system-ui, sans-serif";

  for (const p of state.panels) {
    const r = p.rect;
    if (!r || r.page !== doc.page) continue;
    octx.fillStyle = "rgba(217,102,31,.12)";
    octx.strokeStyle = accent;
    octx.fillRect(r.x * S, r.y * S, r.w * S, r.h * S);
    octx.strokeRect(r.x * S, r.y * S, r.w * S, r.h * S);
    octx.fillStyle = accent;
    octx.fillText(p.mark || "", r.x * S + 4, r.y * S + 14);
  }
  if (drag) {
    const { a, b } = drag;
    octx.strokeStyle = "#1565c0";
    octx.setLineDash([6, 4]);
    if (tool === "line") {
      octx.beginPath();
      octx.moveTo(a.x * S, a.y * S);
      octx.lineTo(b.x * S, b.y * S);
      octx.stroke();
    } else {
      octx.strokeRect(Math.min(a.x, b.x) * S, Math.min(a.y, b.y) * S, Math.abs(b.x - a.x) * S, Math.abs(b.y - a.y) * S);
    }
    octx.setLineDash([]);
    if (doc.mmPerPt) {
      const label =
        tool === "line"
          ? `${Math.round(Math.hypot(b.x - a.x, b.y - a.y) * doc.mmPerPt)} mm`
          : `${Math.round(Math.abs(b.x - a.x) * doc.mmPerPt)} x ${Math.round(Math.abs(b.y - a.y) * doc.mmPerPt)} mm`;
      octx.fillStyle = "#1565c0";
      octx.fillText(label, b.x * S + 8, b.y * S - 8);
    }
  }
  for (const p of calibPts) {
    octx.fillStyle = "#1565c0";
    octx.beginPath();
    octx.arc(p.x * S, p.y * S, 4, 0, Math.PI * 2);
    octx.fill();
  }
}

// ---------------------------------------------------------------- export / print
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
$("btn-csv").addEventListener("click", () => {
  const s = state.settings;
  const q = quote(state.panels, s);
  const rows = [
    ["Client", state.job.client],
    ["Job", state.job.name],
    ["Quote", state.job.quote],
    ["Date", state.job.date],
    [],
    ["Mark", "Qty", "Width mm", "Height mm", "Thickness mm", "Openings", "Edge lm", "Area m2", "Linear $", "Area $", "Total $"],
    ...q.lines.map((l) => [l.mark, l.qty, l.width, l.height, l.thickness, l.openings, round(l.linearM), round(l.areaM2), round(l.linearCost), round(l.areaCost), round(l.total)]),
    [],
    ["Panels", q.panelCount],
    ["Total edge lm", round(q.totalLinearM)],
    ["Total area m2", round(q.totalAreaM2)],
    ["Linear rate $/lm", s.chargeLinear ? s.linearRate : "not charged"],
    ["Area rate $/m2", s.chargeArea ? s.areaRate : "not charged"],
    ["Subtotal ex GST", round(q.subtotal)],
    ["GST", round(q.gst)],
    ["Total", round(q.total)],
  ];
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${(state.job.quote || state.job.name || "panel-patch-quote").replace(/[^\w-]+/g, "_")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
for (const id of ["btn-print", "btn-print-2"]) $(id).addEventListener("click", () => window.print());

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => !$("viewer").hidden && renderPage(), 200);
});

// ---------------------------------------------------------------- boot
state.panels = state.panels.map((p) => ({ ...blankPanel(), ...p }));
onSettingsChanged();
renderTable();
