import { useState, useEffect } from 'react'

export default function Budget() {
  const [budget, setBudget] = useState<any>(null)

  useEffect(() => {
    fetch('/v1/budget/project/project_release_briefs')
      .then(r => r.json()).then(setBudget).catch(() => {})
  }, [])

  if (!budget) return <div style={{ color: '#666' }}>Loading budget...</div>

  return (
    <div>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>Budget Governor</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <MetricCard label="Treasury" value={`$${budget.treasury_balance?.toFixed(2) || '0.00'}`} />
        <MetricCard label="Compute" value={`$${budget.compute_balance?.toFixed(2) || '0.00'}`} />
        <MetricCard label="Runway" value={`${budget.storage_runway_days || 0} days`} />
        <MetricCard label="Survival Reserve" value={`$${budget.survival_reserve?.toFixed(2) || '0.00'}`} />
        <MetricCard label="Reserved" value={`$${budget.total_reserved?.toFixed(2) || '0.00'}`} />
        <MetricCard label="Mode" value={budget.computed_mode || budget.mode || 'UNKNOWN'} />
      </div>

      <div style={{ background: '#1a1a1a', padding: '16px', borderRadius: '8px' }}>
        <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px' }}>RESERVE / EXECUTE / SETTLE</h3>
        <p style={{ color: '#888', fontSize: '12px' }}>
          Every paid action must reserve budget first. Settlement refunds unused reserve. Release returns full amount.
        </p>
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#1a1a1a', padding: '14px', borderRadius: '8px' }}>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '16px', fontWeight: 600 }}>{value}</div>
    </div>
  )
}
