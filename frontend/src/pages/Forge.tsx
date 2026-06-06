import { useState, useEffect } from 'react'

export default function Forge() {
  const [capsules, setCapsules] = useState<any[]>([])
  const [improvements, setImprovements] = useState<any[]>([])
  const [releaseCards, setReleaseCards] = useState<any[]>([])

  useEffect(() => {
    fetch('/v1/forge/capsules').then(r => r.json()).then(setCapsules).catch(() => {})
    fetch('/v1/forge/improvements').then(r => r.json()).then(setImprovements).catch(() => {})
    fetch('/v1/forge/release-cards').then(r => r.json()).then(setReleaseCards).catch(() => {})
  }, [])

  return (
    <div>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>Forge</h1>
      <p style={{ color: '#888', fontSize: '13px', marginBottom: '24px' }}>
        Forge creates possibilities. Eval converts possibilities into trust.
      </p>

      <Section title="Release Cards" items={releaseCards} renderItem={(r: any) => (
        <div key={r.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontWeight: 500, fontSize: '13px' }}>{r.title}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Source: {r.source_name}</div>
        </div>
      )} />

      <Section title="Improvements" items={improvements} renderItem={(i: any) => (
        <div key={i.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontWeight: 500, fontSize: '13px' }}>{i.title}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Status: {i.status}</div>
        </div>
      )} />

      <Section title="Capability Capsules" items={capsules} renderItem={(c: any) => (
        <div key={c.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontWeight: 500, fontSize: '13px' }}>{c.name} v{c.version}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Lifecycle: {c.lifecycle}</div>
        </div>
      )} />
    </div>
  )
}

function Section({ title, items, renderItem }: { title: string; items: any[]; renderItem: (i: any) => JSX.Element }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px' }}>{title} ({items.length})</h3>
      {items.length === 0 ? <p style={{ color: '#555', fontSize: '12px' }}>None</p> : items.map(renderItem)}
    </div>
  )
}
