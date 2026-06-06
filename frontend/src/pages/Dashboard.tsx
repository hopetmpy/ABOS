import { useState, useEffect } from 'react'

interface Project {
  id: string
  name: string
  mission: string
  treasury_balance: number
  compute_balance: number
  storage_runway_days: number
  mode: string
}

export default function Dashboard() {
  const [project, setProject] = useState<Project | null>(null)
  const [agents, setAgents] = useState<any[]>([])

  useEffect(() => {
    fetch('/v1/projects').then(r => r.json()).then(projects => {
      if (projects.length > 0) setProject(projects[0])
    }).catch(() => {})
    fetch('/v1/agents').then(r => r.json()).then(setAgents).catch(() => {})
  }, [])

  if (!project) return <div style={{ color: '#666' }}>No project loaded. Run <code>make seed</code> first.</div>

  return (
    <div>
      <h1 style={{ fontSize: '20px', marginBottom: '8px' }}>Mission Control</h1>
      <p style={{ color: '#888', marginBottom: '24px', fontSize: '13px' }}>
        Sanctuary makes agents sovereign. Conway makes sovereign agents useful, improvable, deployable, and economically alive.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <Card label="Mode" value={project.mode} color={project.mode === 'GREEN' ? '#22c55e' : project.mode === 'YELLOW' ? '#eab308' : '#ef4444'} />
        <Card label="Treasury" value={`$${project.treasury_balance.toFixed(2)}`} />
        <Card label="Runway" value={`${project.storage_runway_days}d`} />
        <Card label="Agents" value={String(agents.length)} />
      </div>

      <div style={{ background: '#1a1a1a', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px' }}>PROJECT</h3>
        <p style={{ fontSize: '15px', fontWeight: 500 }}>{project.name}</p>
        <p style={{ color: '#888', fontSize: '13px', marginTop: '4px' }}>{project.mission}</p>
      </div>

      <div style={{ background: '#1a1a1a', padding: '16px', borderRadius: '8px' }}>
        <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px' }}>THE CONWAY LOOP</h3>
        <p style={{ color: '#aaa', fontSize: '12px', fontFamily: 'monospace' }}>
          Observe → Remember → Suggest → Evaluate → Govern → Deploy → Monetize → Receipt → Learn → Reward → Upgrade
        </p>
      </div>
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#1a1a1a', padding: '16px', borderRadius: '8px' }}>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 600, color: color || '#fff' }}>{value}</div>
    </div>
  )
}
