import type { UiCopy } from "../i18n";
import {
  DEFAULT_PROMPT_TEMPLATES,
  createPromptInjectionTemplate,
  type PromptInjectionTemplate,
  type TemplateScope,
} from "../messageDisplay";

interface MessageTemplateSettingsProps {
  templates: PromptInjectionTemplate[];
  copy: UiCopy["messageTemplates"];
  onChange: (templates: PromptInjectionTemplate[]) => void;
}

function scopeOptions(copy: UiCopy["messageTemplates"]) {
  return (["all", "user", "assistant", "system", "tool"] as const).map((scope) => ({
    value: scope,
    label: copy.scopes[scope],
  }));
}

export default function MessageTemplateSettings({
  templates,
  copy,
  onChange,
}: MessageTemplateSettingsProps) {
  function updateTemplate(
    templateId: string,
    patch: Partial<PromptInjectionTemplate>
  ) {
    onChange(
      templates.map((template) =>
        template.id === templateId ? { ...template, ...patch } : template
      )
    );
  }

  function removeTemplate(templateId: string) {
    onChange(templates.filter((template) => template.id !== templateId));
  }

  return (
    <section className="space-y-3">
      <div className="section-kicker">{copy.title}</div>
      <p className="text-xs leading-5 text-[var(--text-muted)]">{copy.description}</p>

      <div className="space-y-3">
        {templates.map((template) => (
          <div
            key={template.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={template.enabled}
                  onChange={(event) =>
                    updateTemplate(template.id, { enabled: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-600 bg-[var(--bg-input)] text-[var(--accent)] focus:ring-[var(--accent)]"
                />
                {copy.enabled}
              </label>
              <button
                type="button"
                onClick={() => removeTemplate(template.id)}
                className="text-xs font-medium text-rose-500"
              >
                {copy.remove}
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {copy.name}
                </span>
                <input
                  type="text"
                  value={template.name}
                  onChange={(event) =>
                    updateTemplate(template.id, { name: event.target.value })
                  }
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {copy.matchText}
                </span>
                <textarea
                  rows={2}
                  value={template.matchText}
                  onChange={(event) =>
                    updateTemplate(template.id, { matchText: event.target.value })
                  }
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {copy.summary}
                  </span>
                  <input
                    type="text"
                    value={template.summary}
                    onChange={(event) =>
                      updateTemplate(template.id, { summary: event.target.value })
                    }
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-[var(--accent)]"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {copy.scope}
                  </span>
                  <select
                    value={template.appliesTo}
                    onChange={(event) =>
                      updateTemplate(template.id, {
                        appliesTo: event.target.value as TemplateScope,
                      })
                    }
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-[var(--accent)]"
                  >
                    {scopeOptions(copy).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([...templates, createPromptInjectionTemplate()])}
          className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-hover)]"
        >
          {copy.add}
        </button>
        <button
          type="button"
          onClick={() =>
            onChange(DEFAULT_PROMPT_TEMPLATES.map((template) => ({ ...template })))
          }
          className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
        >
          {copy.reset}
        </button>
      </div>
    </section>
  );
}
