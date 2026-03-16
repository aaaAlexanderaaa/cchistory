'use client'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper p-8 text-center">
      <h2 className="font-display text-xl font-semibold text-ink">
        Something went wrong
      </h2>
      <p className="max-w-md text-sm text-muted">
        An unexpected error occurred. You can try again or refresh the page.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted">Error ID: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="rounded-sm border border-border bg-card px-4 py-2 text-sm font-medium text-ink shadow-hard transition-shadow hover:shadow-hover"
      >
        Try again
      </button>
    </div>
  )
}
