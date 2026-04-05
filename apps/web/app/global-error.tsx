'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '1rem',
          backgroundColor: '#F4F1EA',
          color: '#1A1A1A',
        }}
      >
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h2>
        <p style={{ color: '#5F5C57', maxWidth: '400px' }}>
          A critical error occurred. Please try refreshing the page.
        </p>
        <button
          onClick={reset}
          style={{
            padding: '0.5rem 1rem',
            border: '1px solid #D6CFC2',
            background: '#FFFFFF',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
