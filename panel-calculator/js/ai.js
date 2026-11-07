// AI drawing reader: sends the PDF to Claude and gets back a structured panel
// schedule. Runs in the browser with the user's own Anthropic API key, which
// is only ever sent to api.anthropic.com.
import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.137.0/+esm";

export const MODEL = "claude-opus-5-5";

const PANEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["panels", "notes"],
  properties: {
    panels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["mark", "qty", "width_mm", "height_mm", "thickness_mm", "openings", "page", "confidence"],
        properties: {
          mark: { type: "string", description: "Panel mark/ID as shown on the drawing, e.g. P1, PNL-07" },
          qty: { type: "integer", description: "Number of identical panels with this mark" },
          width_mm: { type: "number", description: "Overall panel width (length along the wall) in mm" },
          height_mm: { type: "number", description: "Overall panel height in mm" },
          thickness_mm: { type: ["number", "null"] },
          openings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["width_mm", "height_mm", "count"],
              properties: {
                width_mm: { type: "number" },
                height_mm: { type: "number" },
                count: { type: "integer" },
              },
            },
          },
          page: { type: ["integer", "null"], description: "PDF page the panel was read from" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    notes: { type: "string", description: "Short notes on assumptions, unreadable areas or anything the estimator should check" },
  },
};

const SYSTEM = `You are an estimator's assistant for a concrete tilt-up panel patching contractor.
You read structural / shop drawings (panel layouts, elevations, panel schedules) and produce a panel schedule.
Rules:
- One entry per distinct panel mark. If the drawing shows several identical panels sharing a mark, set qty accordingly. Never list the same panel twice (it often appears on plan, elevation and schedule sheets).
- Dimensions in millimetres: width = horizontal length of the panel, height = vertical height. Prefer dimensions from a panel schedule table; otherwise read the elevation dimension strings. Convert metres to mm.
- List openings (doors, windows, roller doors, penetrations) in each panel with their sizes.
- If a value can't be read, give your best estimate and mark confidence "low"; explain in notes.
- Do not invent panels that are not on the drawings.`;

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.pdfBase64  base64 PDF (no data: prefix)
 * @param {(msg: string) => void} [opts.onProgress]
 */
export async function readDrawingWithClaude({ apiKey, pdfBase64, onProgress = () => {} }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  onProgress("Sending drawing to Claude…");
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: PANEL_SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: "Read these tilt-up panel drawings and return the complete panel schedule." },
        ],
      },
    ],
  });

  let chars = 0;
  stream.on("text", (delta) => {
    chars += delta.length;
    onProgress(`Claude is reading the drawings… (${chars.toLocaleString()} chars received)`);
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to read this document.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The drawing set is too large to read in one pass - try uploading fewer pages.");
  }
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Claude returned an unreadable response. Please try again.");
  }

  const panels = (data.panels || []).map((p) => ({
    mark: p.mark,
    qty: p.qty || 1,
    width: Math.round(p.width_mm) || null,
    height: Math.round(p.height_mm) || null,
    thickness: p.thickness_mm ? Math.round(p.thickness_mm) : null,
    openings: (p.openings || []).map((o) => ({ w: Math.round(o.width_mm), h: Math.round(o.height_mm), count: o.count || 1 })),
    page: p.page ?? null,
    confidence: p.confidence,
    source: "AI",
  }));
  return { panels, notes: data.notes || "" };
}

export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid Anthropic API key.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to the model.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API - wait a minute and retry.";
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API - check your connection.";
  if (err instanceof Anthropic.APIError) return `API error ${err.status}: ${err.message}`;
  return err?.message || String(err);
}
