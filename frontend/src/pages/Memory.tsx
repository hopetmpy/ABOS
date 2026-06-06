import { useState, useEffect } from 'react'

export default function Memory() {
  const [memories, setMemories] = useState<any[]>([])

  useEffect(() => {
    fetch('/v1/memory?project_id=project_release_briefs')
      .then(r => r.json()).then(setMemories).catch(() => {})
  }, [])

  const typeColors: Record<string, string> = {
    episodic: '#3b82f6',
    semantic: '#8b5cf6',
    procedural: '#22c55e',
    strategic: '#eab308',
    financial: '#ef4444',
  }

  return (
    <div>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>Memory</h1>

      {memories.length === 0 && <p style={{ color: '#666' }}>No memories yet. Run the demo first.</p>}

      {memories.map(m => (
        <div key={m.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', fontWeight: 500 }}>{m.statement}</span>
            <span style={{
              fontSize: '10px', padding: '2px 6px', borderRadius: '3px',
              background: '#1f1f1f', color: typeColors[m.memory_type] || '#888',
            }}>
              {m.memory_type}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#555' }}>
            Confidence: {m.confidence} | Importance: {m.importance} | Privacy: {m.privacy_label}
          </div>
        </div>
      ))}
    </div>
  )
}
