import { useState, useEffect } from 'react'

interface Suggestion {
  id: string
  title: string
  candidate_type: string
  recommended_decision: string
  expected_benefit: any
  expected_cost: any
  risk_summary: any
  permission_diff: any
  candidate_efficiency: number
  status: string
}

export default function Suggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/v1/suggestions/project_release_briefs')
      .then(r => r.json()).then(setSuggestions).catch(() => {})
  }, [])

  const generate = async () => {
    setLoading(true)
    const resp = await fetch('/v1/suggestions/generate/project_release_briefs', { method: 'POST' })
    const data = await resp.json()
    setSuggestions(data)
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px' }}>Suggestions</h1>
        <button onClick={generate} disabled={loading} style={{
          padding: '8px 16px', background: '#8b5cf6', color: '#fff', border: 'none',
          borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
        }}>
          {loading ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {suggestions.length === 0 && <p style={{ color: '#666' }}>No suggestions yet. Click Generate.</p>}

      {suggestions.map(s => (
        <div key={s.id} style={{
          background: '#1a1a1a', padding: '16px', borderRadius: '8px', marginBottom: '12px',
          borderLeft: `3px solid ${s.recommended_decision === 'AUTO_INSTALL' ? '#22c55e' : s.recommended_decision === 'CANARY' ? '#eab308' : '#ef4444'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontWeight: 500, fontSize: '14px' }}>{s.title}</span>
            <span style={{
              fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
              background: s.recommended_decision === 'AUTO_INSTALL' ? '#14532d' : '#1c1917',
              color: s.recommended_decision === 'AUTO_INSTALL' ? '#4ade80' : '#888',
            }}>
              {s.recommended_decision}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '12px', color: '#888' }}>
            <div>Benefit: {JSON.stringify(s.expected_benefit)}</div>
            <div>Cost: {JSON.stringify(s.expected_cost)}</div>
            <div>Risk: {s.risk_summary?.level || 'unknown'}</div>
          </div>
          <div style={{ fontSize: '11px', color: '#555', marginTop: '8px' }}>
            Efficiency: {s.candidate_efficiency?.toFixed(3)} | Type: {s.candidate_type}
          </div>
        </div>
      ))}
    </div>
  )
}
