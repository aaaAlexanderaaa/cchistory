'use client'

import { useState, type MouseEvent } from 'react'
import { Check, Copy } from 'lucide-react'

interface CopyButtonProps {
  text: string
  title?: string
}

export function CopyButton({ text, title = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-0.5 text-muted hover:text-ink"
      title={title}
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}
