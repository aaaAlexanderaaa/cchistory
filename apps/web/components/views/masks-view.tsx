'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useMasksQuery } from '@/lib/api'
import { ResponsiveSidePanel } from '@/components/responsive-side-panel'
import type { MaskTemplate } from '@/lib/types'
import { applyMasks, extractCanonicalText } from '@/lib/mask-utils'
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Play,
  Shield,
  ArrowUpDown,
  X,
} from 'lucide-react'

export function MasksView() {
  const { data: templates = [] } = useMasksQuery()
  const [selectedTemplate, setSelectedTemplate] = useState<MaskTemplate | null>(null)
  const [testInput, setTestInput] = useState('')
  const [sortBy, setSortBy] = useState<'priority' | 'name' | 'updated'>('priority')
  const sortedTemplates = useMemo(() => {
    const items = [...templates]
    items.sort((left, right) => {
      if (sortBy === 'name') {
        return left.name.localeCompare(right.name)
      }
      if (sortBy === 'updated') {
        return right.updated_at.getTime() - left.updated_at.getTime()
      }
      return left.priority - right.priority
    })
    return items
  }, [sortBy, templates])
  const activeTemplates = sortedTemplates.filter((template) => template.is_active)

  const preview = useMemo(() => {
    if (!selectedTemplate || testInput.length === 0) {
      return null
    }
    const segments = applyMasks(testInput, [selectedTemplate], 'assistant_reply')
    return {
      segments,
      canonicalText: extractCanonicalText(segments),
    }
  }, [selectedTemplate, testInput])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-ink" />
          <h1 className="text-lg font-bold font-display text-ink">Mask Templates</h1>
          <span className="text-sm text-muted">{activeTemplates.length} active</span>
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted" />
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
            className="border border-border bg-card px-2 py-1.5 text-sm text-text focus:border-ink focus:outline-none"
          >
            <option value="priority">Priority</option>
            <option value="updated">Recently Updated</option>
            <option value="name">Name</option>
          </select>
        </div>
      </header>

      <div className="border-b border-accent/20 bg-accent/5 px-4 py-3 text-sm text-text sm:px-6">
        Deterministic masks are applied before search indexing and display projection. Original evidence remains preserved.
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className={cn('flex-1 overflow-y-auto p-4 sm:p-6', selectedTemplate && 'lg:border-r lg:border-border')}>
          <TemplateSection
            title="Built-in Templates"
            description="Current canonical mask rules from the local API."
            templates={sortedTemplates}
            selectedId={selectedTemplate?.id}
            onSelect={setSelectedTemplate}
          />
        </div>

        {selectedTemplate && (
          <ResponsiveSidePanel onDismiss={() => setSelectedTemplate(null)} className="lg:w-[420px] lg:flex-shrink-0">
            <div className="flex h-full flex-col bg-card lg:w-[420px] lg:flex-shrink-0">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink">{selectedTemplate.name}</div>
                  <div className="text-xs text-muted">{selectedTemplate.description || selectedTemplate.match_pattern}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto p-4 text-sm">
                <DetailRow label="Pattern" value={selectedTemplate.match_pattern} mono />
                <DetailRow label="Match Type" value={selectedTemplate.match_type} />
                <DetailRow label="Collapse Label" value={selectedTemplate.collapse_label} />
                <DetailRow label="Applies To" value={selectedTemplate.applies_to.join(', ')} />
                <DetailRow label="Priority" value={String(selectedTemplate.priority)} />

                <div className="border-t border-border pt-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] stamp-text text-muted">
                    <Play className="h-3 w-3" />
                    Test Template
                  </div>
                  <textarea
                    value={testInput}
                    onChange={(event) => setTestInput(event.target.value)}
                    placeholder="Paste sample content to preview masking..."
                    className="min-h-40 w-full border border-border bg-paper p-3 text-sm text-text focus:border-ink focus:outline-none"
                  />
                </div>

                {preview && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <div>
                      <div className="mb-1 text-[10px] stamp-text text-muted">Display Segments</div>
                      <div className="border border-border bg-paper p-3 text-sm text-text">
                        {preview.segments.map((segment, index) => (
                          <span
                            key={`${segment.type}-${index}`}
                            className={cn(
                              segment.type === 'masked' && 'border border-border bg-card px-1 py-0.5 text-xs mono-text text-muted',
                            )}
                          >
                            {segment.content}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-[10px] stamp-text text-muted">Canonical Text</div>
                      <div className="border border-border bg-paper p-3 text-sm text-text">
                        {preview.canonicalText || 'Masked content removed canonical text.'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ResponsiveSidePanel>
        )}
      </div>
    </div>
  )
}

function TemplateSection({
  title,
  description,
  templates,
  selectedId,
  onSelect,
}: {
  title: string
  description: string
  templates: MaskTemplate[]
  selectedId?: string
  onSelect: (template: MaskTemplate) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div>
      <button type="button" onClick={() => setCollapsed((value) => !value)} className="mb-3 flex w-full items-center gap-2 text-left">
        {collapsed ? <ChevronRight className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
        <div>
          <div className="text-sm font-medium text-ink">{title}</div>
          <div className="text-xs text-muted">{description}</div>
        </div>
        <span className="ml-auto text-xs mono-text text-muted">{templates.length}</span>
      </button>

      {!collapsed && (
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              type="button"
              key={template.id}
              onClick={() => onSelect(template)}
              className={cn(
                'w-full border p-4 text-left transition-colors',
                template.id === selectedId ? 'border-accent bg-accent/5' : 'border-border bg-card hover:border-ink',
              )}
            >
              <div className="flex items-start gap-3">
                <Lock className="mt-0.5 h-4 w-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{template.name}</div>
                  <div className="mt-1 text-xs text-muted">{template.description || template.match_pattern}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] stamp-text text-muted">
                    <span className="border border-border bg-paper px-1.5 py-0.5">{template.match_type}</span>
                    <span className="border border-border bg-paper px-1.5 py-0.5">{template.collapse_label}</span>
                    <span className="border border-border bg-paper px-1.5 py-0.5">priority {template.priority}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn('text-right text-ink', mono && 'mono-text text-xs')}>{value}</span>
    </div>
  )
}
