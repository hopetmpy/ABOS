import { useState, useEffect } from 'react'

export default function Rewards() {
  const [payments, setPayments] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])
  const [attestations, setAttestations] = useState<any[]>([])

  useEffect(() => {
    fetch('/v1/rewards/payments').then(r => r.json()).then(setPayments).catch(() => {})
    fetch('/v1/rewards/ledger').then(r => r.json()).then(setLedger).catch(() => {})
    fetch('/v1/rewards/usage-attestations').then(r => r.json()).then(setAttestations).catch(() => {})
  }, [])

  return (
    <div>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>Rewards & Revenue</h1>

      <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px' }}>PAYMENTS ({payments.length})</h3>
      {payments.map(p => (
        <div key={p.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px' }}>${p.amount} on {p.route}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Status: {p.status}</div>
        </div>
      ))}

      <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px', marginTop: '24px' }}>
        USAGE ATTESTATIONS ({attestations.length})
      </h3>
      {attestations.map(a => (
        <div key={a.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px' }}>Capability: {a.capability_id}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Royalty: ${a.royalty_due}</div>
        </div>
      ))}

      <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px', marginTop: '24px' }}>
        REWARD LEDGER ({ledger.length})
      </h3>
      {ledger.map(e => (
        <div key={e.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px' }}>{e.recipient_id}: ${e.amount?.toFixed(4)}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Status: {e.status}</div>
        </div>
      ))}
    </div>
  )
}
