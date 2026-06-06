import { useState, useEffect } from 'react'

export default function Deploy() {
  const [capsules, setCapsules] = useState<any[]>([])
  const [leases, setLeases] = useState<any[]>([])
  const [receipts, setReceipts] = useState<any[]>([])

  useEffect(() => {
    fetch('/v1/deploy/capsules').then(r => r.json()).then(setCapsules).catch(() => {})
    fetch('/v1/deploy/leases').then(r => r.json()).then(setLeases).catch(() => {})
    fetch('/v1/receipts/deployment').then(r => r.json()).then(setReceipts).catch(() => {})
  }, [])

  return (
    <div>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>Deployments</h1>

      <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px' }}>CAPSULES ({capsules.length})</h3>
      {capsules.map(c => (
        <div key={c.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: 500 }}>{c.name}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Status: {c.lifecycle}</div>
        </div>
      ))}

      <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px', marginTop: '24px' }}>LEASES ({leases.length})</h3>
      {leases.map(l => (
        <div key={l.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px' }}>Provider: {l.provider}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Status: {l.status}</div>
        </div>
      ))}

      <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px', marginTop: '24px' }}>RECEIPTS ({receipts.length})</h3>
      {receipts.map(r => (
        <div key={r.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px' }}>{r.id}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Summary: {JSON.stringify(r.public_summary)}</div>
        </div>
      ))}
    </div>
  )
}
