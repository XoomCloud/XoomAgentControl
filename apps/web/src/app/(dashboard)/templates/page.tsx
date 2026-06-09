"use client";

import { useFetch, Loading, ErrorBox } from "@/lib/ui";

interface Template {
  id: string;
  name: string;
  description: string | null;
  defaultSystemPrompt: string | null;
  skillsJson?: string[];
  mcpToolsJson?: string[];
  memoryPolicyJson?: Record<string, unknown>;
  llmPolicyJson?: Record<string, unknown>;
}

export default function TemplatesPage() {
  const { data, error, loading } = useFetch<{ templates: Template[] }>("/api/agent-templates");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Agent Templates</div>
          <div className="page-desc">Reusable agent packs: prompts, skills, schedules, MCP tools, memory &amp; LLM policy.</div>
        </div>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {data && (
        <div className="grid grid-2">
          {data.templates.length === 0 && <div className="empty">No templates defined.</div>}
          {data.templates.map((t) => (
            <div className="card" key={t.id}>
              <div className="card-title" style={{ fontSize: 16 }}>
                ✦ {t.name}
              </div>
              <p className="muted">{t.description ?? "No description"}</p>
              {t.defaultSystemPrompt && (
                <pre className="json" style={{ whiteSpace: "pre-wrap" }}>
                  {t.defaultSystemPrompt}
                </pre>
              )}
              <div className="sep" />
              <div className="faint" style={{ marginBottom: 4 }}>
                Skills
              </div>
              <div>{(t.skillsJson ?? []).map((s) => <span key={s} className="tag">{s}</span>)}</div>
              <div className="faint" style={{ margin: "10px 0 4px" }}>
                MCP tools
              </div>
              <div>{(t.mcpToolsJson ?? []).map((s) => <span key={s} className="tag">{s}</span>)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
