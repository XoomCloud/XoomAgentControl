import test from "node:test";
import assert from "node:assert/strict";
import { quote, measurePanel, parseOpenings, formatOpenings } from "../js/calc.js";
import { extractPanels, dimsFromText } from "../js/parser.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("parseOpenings handles counts and separators", () => {
  assert.deepEqual(parseOpenings("1200x2100, 2@900x900"), [
    { count: 1, w: 1200, h: 2100 },
    { count: 2, w: 900, h: 900 },
  ]);
  assert.deepEqual(parseOpenings(""), []);
  assert.equal(formatOpenings(parseOpenings("2@900x900")), "2@900x900");
});

test("measurePanel: all edges, one face, openings deducted", () => {
  const m = measurePanel({ width: 6000, height: 8000, openings: "1000x2000" }, {});
  // edges: 6+6+8+8 = 28 m, opening perimeter 6 m
  close(m.linearM, 34);
  // area: 48 - 2 = 46 m²
  close(m.areaM2, 46);
});

test("measurePanel respects edge selection and faces", () => {
  const s = { edgeTop: false, edgeBottom: false, edgeSides: true, edgeOpenings: false, faces: 2, deductOpenings: false };
  const m = measurePanel({ width: 6000, height: 8000, openings: "1000x2000" }, s);
  close(m.linearM, 16);
  close(m.areaM2, 96);
});

test("quote: linear only, area only, both", () => {
  const panels = [{ mark: "P1", qty: 2, width: 5000, height: 4000, openings: "" }];
  // per panel: 18 lm, 20 m²; x2 = 36 lm, 40 m²
  const both = quote(panels, { linearRate: 10, areaRate: 5, gst: false });
  close(both.totalLinearM, 36);
  close(both.totalAreaM2, 40);
  close(both.linearCost, 360);
  close(both.areaCost, 200);
  close(both.total, 560);

  const linOnly = quote(panels, { chargeArea: false, linearRate: 10, areaRate: 5, gst: false });
  close(linOnly.total, 360);
  const areaOnly = quote(panels, { chargeLinear: false, linearRate: 10, areaRate: 5, gst: false });
  close(areaOnly.total, 200);
});

test("quote: GST and minimum charge", () => {
  const panels = [{ qty: 1, width: 1000, height: 1000 }];
  const q = quote(panels, { linearRate: 1, areaRate: 1, minimumCharge: 500, gst: true, gstRate: 10 });
  assert.equal(q.minimumApplied, true);
  close(q.subtotal, 500);
  close(q.gst, 50);
  close(q.total, 550);
});

test("dimsFromText reads pairs, metres and schedule columns", () => {
  assert.deepEqual(dimsFromText(" 6000 x 8400 THK 200"), { width: 6000, height: 8400, thickness: 200 });
  assert.equal(dimsFromText(" 6.4 x 9.25").width, 6400);
  assert.deepEqual(dimsFromText(" 7,200 9,100 175"), { width: 7200, height: 9100, thickness: 175 });
  assert.equal(dimsFromText(" GRID A"), null);
  // opening callouts must not be read as the panel size
  assert.deepEqual(dimsFromText(" 7200 9000 200 RSD 4000x4500"), { width: 7200, height: 9000, thickness: 200 });
  assert.deepEqual(dimsFromText(" 4800 8400 175 PA DOOR 920x2100"), { width: 4800, height: 8400, thickness: 175 });
});

const item = (str, x, y) => ({ str, x, y });

test("extractPanels: schedule table + duplicate marks on elevations", () => {
  const pages = [
    {
      page: 1,
      items: [
        item("PANEL SCHEDULE", 50, 800),
        item("MARK", 50, 780), item("WIDTH", 120, 780), item("HEIGHT", 190, 780), item("THK", 260, 780),
        item("P1", 50, 760), item("6000", 120, 760), item("8400", 190, 760), item("200", 260, 760),
        item("P2", 50, 740), item("5400", 120, 740), item("8400", 190, 740), item("200", 260, 740), item("2 OFF", 330, 740),
        item("P3", 50, 720), item("7200", 120, 720), item("9000", 190, 720), item("200", 260, 720), item("RSD 4000x4500", 330, 720),
      ],
    },
    { page: 2, items: [item("P1", 100, 500), item("P2", 300, 500), item("P-03", 500, 500)] },
  ];
  const { panels } = extractPanels(pages);
  assert.deepEqual(panels.map((p) => p.mark), ["P1", "P2", "P3"]);
  const [p1, p2, p3] = panels;
  assert.equal(p1.width, 6000);
  assert.equal(p1.height, 8400);
  assert.equal(p1.thickness, 200);
  assert.equal(p2.qty, 2);
  assert.equal(p3.width, 7200);
  assert.equal(p3.height, 9000);
  assert.deepEqual(p3.openings, [{ w: 4000, h: 4500, count: 1 }]);
});

test("extractPanels: elevation label with size on next line", () => {
  const pages = [{ page: 1, items: [item("PNL 12", 100, 400), item("6000 x 8400", 100, 388)] }];
  const { panels } = extractPanels(pages);
  assert.equal(panels.length, 1);
  assert.equal(panels[0].mark, "P12");
  assert.equal(panels[0].width, 6000);
});
