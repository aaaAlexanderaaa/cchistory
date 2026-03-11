import type { DisplaySegment } from './types'
import type { MaskTemplate } from './types'

/**
 * Mask Utilities
 * 
 * These functions apply MaskTemplates to raw text to produce DisplaySegments.
 * Per the design doc (Section 10):
 * - Masking is deterministic
 * - Masking is reversible at display time
 * - Masking affects derived text, not stored raw evidence
 */

/**
 * Apply mask templates to raw text and return display segments
 */
export function applyMasks(
  rawText: string,
  templates: MaskTemplate[],
  context: 'user_message' | 'system_message' | 'assistant_reply' | 'tool_input' | 'tool_output'
): DisplaySegment[] {
  // Filter to active templates that apply to this context
  const applicableTemplates = templates
    .filter(t => t.is_active && t.applies_to.includes(context))
    .sort((a, b) => a.priority - b.priority) // Lower priority = higher precedence
  
  if (applicableTemplates.length === 0) {
    return [{ type: 'text', content: rawText }]
  }
  
  // Track which regions are already masked
  const maskedRegions: Array<{ start: number; end: number; segment: DisplaySegment }> = []
  
  for (const template of applicableTemplates) {
    const matches = findMatches(rawText, template)
    
    for (const match of matches) {
      // Check if this region overlaps with already masked regions
      const overlaps = maskedRegions.some(
        region => !(match.end <= region.start || match.start >= region.end)
      )
      
      if (!overlaps) {
        const segment = createMaskedSegment(rawText, match, template)
        maskedRegions.push({ start: match.start, end: match.end, segment })
      }
    }
  }
  
  // Sort regions by start position
  maskedRegions.sort((a, b) => a.start - b.start)
  
  // Build final segments
  const segments: DisplaySegment[] = []
  let currentPos = 0
  
  for (const region of maskedRegions) {
    // Add any text before this masked region
    if (region.start > currentPos) {
      segments.push({
        type: 'text',
        content: rawText.slice(currentPos, region.start),
      })
    }
    
    segments.push(region.segment)
    currentPos = region.end
  }
  
  // Add any remaining text
  if (currentPos < rawText.length) {
    segments.push({
      type: 'text',
      content: rawText.slice(currentPos),
    })
  }
  
  return segments.length > 0 ? segments : [{ type: 'text', content: rawText }]
}

interface Match {
  start: number
  end: number
  content: string
}

function findMatches(text: string, template: MaskTemplate): Match[] {
  const matches: Match[] = []
  
  switch (template.match_type) {
    case 'regex': {
      try {
        const regex = new RegExp(template.match_pattern, 'g')
        let match
        while ((match = regex.exec(text)) !== null) {
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            content: match[0],
          })
        }
      } catch {
        // Invalid regex, skip
      }
      break
    }
    
    case 'prefix': {
      if (text.startsWith(template.match_pattern)) {
        // Find where the "prefix section" ends (e.g., until a separator)
        const prefixEnd = findPrefixEnd(text, template.match_pattern)
        matches.push({
          start: 0,
          end: prefixEnd,
          content: text.slice(0, prefixEnd),
        })
      }
      break
    }
    
    case 'contains': {
      let pos = 0
      while ((pos = text.indexOf(template.match_pattern, pos)) !== -1) {
        matches.push({
          start: pos,
          end: pos + template.match_pattern.length,
          content: template.match_pattern,
        })
        pos += template.match_pattern.length
      }
      break
    }
    
  }
  
  return matches
}

function findPrefixEnd(text: string, prefix: string): number {
  // Look for common separators that indicate end of prefix content
  const separators = ['\n\n---\n\n', '\n---\n', '\n\n====\n\n', '\n====\n', '\n\nUser:', '\nUser:']
  
  for (const sep of separators) {
    const idx = text.indexOf(sep)
    if (idx !== -1) {
      return idx + sep.length
    }
  }
  
  // If no separator found, mask up to a reasonable length or the whole text
  const maxPrefixLength = 5000
  return Math.min(text.length, maxPrefixLength)
}

function createMaskedSegment(
  text: string, 
  match: Match, 
  template: MaskTemplate
): DisplaySegment {
  if (template.action === 'collapse') {
    return {
      type: 'masked',
      content: `[MASKED: ${template.collapse_label || template.name}]`,
      mask_label: template.collapse_label || template.name,
      mask_char_count: match.content.length,
      mask_template_id: template.id,
      original_content: match.content,
      is_expanded: false,
    }
  }

  return {
    type: 'text',
    content: match.content,
  }
}

/**
 * Extract canonical text from display segments
 * This is the text used for search indexing
 */
export function extractCanonicalText(segments: DisplaySegment[]): string {
  return segments
    .map(seg => {
      switch (seg.type) {
        case 'masked':
          // Masked content is excluded from canonical text
          return ''
        case 'text':
        case 'highlight':
        case 'code':
        case 'reference':
          return seg.content
        case 'injected':
          // Injected content is excluded from canonical text
          return ''
        default:
          return seg.content
      }
    })
    .join('')
    .trim()
}

/**
 * Count characters in original content (before masking)
 */
export function countOriginalChars(segments: DisplaySegment[]): number {
  return segments.reduce((total, seg) => {
    if (seg.type === 'masked' && seg.original_content) {
      return total + seg.original_content.length
    }
    return total + seg.content.length
  }, 0)
}

/**
 * Built-in mask templates for common patterns
 */
export const BUILTIN_TEMPLATES: MaskTemplate[] = [
  {
    id: 'builtin-system-prompt-v0',
    name: 'v0 System Prompt',
    description: 'Detects v0 system prompts',
    match_type: 'prefix',
    match_pattern: 'You are v0, Vercel',
    action: 'collapse',
    collapse_label: 'v0 System Prompt',
    priority: 0,
    applies_to: ['user_message', 'system_message'],
    is_builtin: true,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'builtin-system-prompt-claude',
    name: 'Claude System Prompt',
    description: 'Detects Claude system prompts',
    match_type: 'regex',
    match_pattern: '^(The assistant is Claude|You are Claude)',
    action: 'collapse',
    collapse_label: 'Claude System Prompt',
    priority: 0,
    applies_to: ['user_message', 'system_message'],
    is_builtin: true,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'builtin-automated-reminder',
    name: 'Automated Reminder',
    description: 'Detects automated v0 instruction reminders',
    match_type: 'contains',
    match_pattern: '<automated_v0_instructions_reminder>',
    action: 'collapse',
    collapse_label: 'Automated Reminder',
    priority: 1,
    applies_to: ['user_message', 'system_message', 'tool_output'],
    is_builtin: true,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'builtin-api-key',
    name: 'API Key Detection',
    description: 'Masks potential API keys and secrets',
    match_type: 'regex',
    match_pattern: '(sk-[a-zA-Z0-9]{20,}|api[_-]?key["\']?\\s*[:=]\\s*["\']?[a-zA-Z0-9_-]{20,})',
    action: 'collapse',
    collapse_label: 'API Key',
    priority: 0,
    applies_to: ['user_message', 'assistant_reply', 'tool_input', 'tool_output'],
    is_builtin: true,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'builtin-large-file',
    name: 'Large File Content',
    description: 'Masks very large text blocks',
    match_type: 'regex',
    match_pattern: '.{10000,}', // 10k+ chars
    action: 'collapse',
    collapse_label: 'Large Content',
    priority: 100, // Low priority - only if nothing else matches
    applies_to: ['tool_output'],
    is_builtin: true,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
]
