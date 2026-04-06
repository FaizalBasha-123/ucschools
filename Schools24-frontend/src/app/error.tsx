'use client'

import { useEffect } from 'react'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '40px' }}>
      <h2 style={{ color: '#dc2626' }}>Something went wrong</h2>
      <pre style={{ background: '#f5f5f5', padding: '16px', borderRadius: '8px', overflow: 'auto', fontSize: '13px' }}>
        {error?.message}{'\n'}{error?.stack}
      </pre>
      <button onClick={reset} style={{ marginTop: '16px', padding: '8px 16px', cursor: 'pointer' }}>Try again</button>
    </div>
  )
}