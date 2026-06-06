import { useState, useEffect } from 'react'

interface EvalRun {
  id: string
  target_id: string
  status: string
  eval_mode: string
  baseline_id?: string
  baseline_scores?: Record<string, number>
  candidate_scores?: Record<string, number>
  score_delta?: Record<string, number>
  winner?: string
  recommendation?: string
  rubric_auto_generated?: string
}

export default function Eval() {
  const [runs, setRuns] = useState<EvalRun[]>([])
  const [attestations, setAttestations] = useState<any[]>([])
  const [deploying, setDeploying] = useState<string | null>(null)
  const [deployResult, setDeployResult] = useState<string | null>(null)

  const loadData = () => {
    fetch('/v1/eval/runs').then(r => r.json()).then(setRuns).catch(() => {})
    fetch('/v1/eval/attestations').then(r => r.json()).then(setAttestations).catch(() => {})
  }

  useEffect(loadData, [])

  const deployCandidate = async (runId: string) => {
    setDeploying(runId)
    setDeployResult(null)
    try {
      const resp = await fetch(`/v1/eval/runs/${runId}/deploy-candidate`, { method: 'POST' })
      const data = await resp.json()
      if (resp.ok) {
        setDeployResult(`Deployed: ${data.message}`)
      } else {
        setDeployResult(`Error: ${data.detail}`)
      }
    } catch {
      setDeployResult('Deploy failed')
    }
    setDeploying(null)
  }

  const comparativeRuns = runs.filter(r => r.eval_mode === 'comparative')
  const singleRuns = runs.filter(r => r.eval_mode !== 'comparative')

  return (
    <div>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>Eval</h1>

      {comparativeRuns.length > 0 && (
        <>
          <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px' }}>
            COMPARATIVE EVALS ({comparativeRuns.length})
          </h3>
          {comparativeRuns.map(r => (
            <ComparativeCard
              key={r.id}
              run={r}
              onDeploy={() => deployCandidate(r.id)}
              deploying={deploying === r.id}
            />
          ))}
        </>
      )}

      {deployResult && (
        <div style={{
          padding: '12px', background: '#14532d', borderRadius: '6px',
          marginBottom: '16px', color: '#4ade80', fontSize: '13px',
        }}>
          {deployResult}
        </div>
      )}

      {singleRuns.length > 0 && (
        <>
          <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px', marginTop: '24px' }}>
            EVAL RUNS ({singleRuns.length})
          </h3>
          {singleRuns.map(r => (
            <div key={r.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px' }}>{r.target_id}</span>
                <span style={{
                  fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                  background: r.status === 'PASSED' ? '#14532d' : '#7f1d1d',
                  color: r.status === 'PASSED' ? '#4ade80' : '#fca5a5',
                }}>{r.status}</span>
              </div>
            </div>
          ))}
        </>
      )}

      <h3 style={{ fontSize: '13px', color: '#8b5cf6', marginBottom: '8px', marginTop: '24px' }}>
        ATTESTATIONS ({attestations.length})
      </h3>
      {attestations.map(a => (
        <div key={a.id} style={{ padding: '12px', background: '#1a1a1a', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ fontSize: '13px' }}>Target: {a.target_id}</div>
          <div style={{ fontSize: '11px', color: '#666' }}>Canary: {a.canary_status}</div>
        </div>
      ))}
    </div>
  )
}

function ComparativeCard({
  run,
  onDeploy,
  deploying,
}: {
  run: EvalRun
  onDeploy: () => void
  deploying: boolean
}) {
  const baselineScores = run.baseline_scores || {}
  const candidateScores = run.candidate_scores || {}
  const deltas = run.score_delta || {}
  const dims = Object.keys(candidateScores)

  const baselineAvg = dims.length
    ? dims.reduce((s, d) => s + (baselineScores[d] || 0), 0) / dims.length
    : 0
  const candidateAvg = dims.length
    ? dims.reduce((s, d) => s + (candidateScores[d] || 0), 0) / dims.length
    : 0

  const winnerColor = run.winner === 'candidate' ? '#4ade80' : run.winner === 'baseline' ? '#fbbf24' : '#94a3b8'
  const recColor = run.recommendation === 'deploy_candidate' ? '#4ade80'
    : run.recommendation === 'keep_baseline' ? '#fbbf24' : '#94a3b8'

  return (
    <div style={{
      padding: '16px', background: '#1a1a1a', borderRadius: '8px', marginBottom: '12px',
      borderLeft: `3px solid ${winnerColor}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>
            Baseline vs Candidate
          </div>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
            {run.baseline_id?.slice(0, 24)} → {run.target_id?.slice(0, 24)}
          </div>
          {run.rubric_auto_generated === 'true' && (
            <span style={{
              fontSize: '10px', padding: '1px 6px', borderRadius: '3px',
              background: '#1e1b4b', color: '#818cf8', marginTop: '4px', display: 'inline-block',
            }}>AUTO-GENERATED RUBRIC</span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{
            fontSize: '12px', padding: '3px 10px', borderRadius: '4px',
            background: run.winner === 'candidate' ? '#14532d' : '#78350f',
            color: winnerColor, fontWeight: 600,
          }}>
            WINNER: {(run.winner || 'unknown').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Score comparison table */}
      <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px', color: '#888' }}>Dimension</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', color: '#f97316' }}>Baseline</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', color: '#4ade80' }}>Candidate</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', color: '#888' }}>Delta</th>
          </tr>
        </thead>
        <tbody>
          {dims.map(dim => {
            const delta = deltas[dim] || 0
            const deltaColor = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#666'
            return (
              <tr key={dim} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '4px 8px', color: '#ccc' }}>{dim.replace(/_/g, ' ')}</td>
                <td style={{ textAlign: 'right', padding: '4px 8px', color: '#f97316' }}>
                  {(baselineScores[dim] || 0).toFixed(3)}
                </td>
                <td style={{ textAlign: 'right', padding: '4px 8px', color: '#4ade80' }}>
                  {(candidateScores[dim] || 0).toFixed(3)}
                </td>
                <td style={{ textAlign: 'right', padding: '4px 8px', color: deltaColor }}>
                  {delta > 0 ? '+' : ''}{delta.toFixed(3)}
                </td>
              </tr>
            )
          })}
          <tr style={{ borderTop: '2px solid #444', fontWeight: 600 }}>
            <td style={{ padding: '6px 8px', color: '#fff' }}>Weighted Average</td>
            <td style={{ textAlign: 'right', padding: '6px 8px', color: '#f97316' }}>
              {baselineAvg.toFixed(3)}
            </td>
            <td style={{ textAlign: 'right', padding: '6px 8px', color: '#4ade80' }}>
              {candidateAvg.toFixed(3)}
            </td>
            <td style={{ textAlign: 'right', padding: '6px 8px', color: candidateAvg > baselineAvg ? '#4ade80' : '#f87171' }}>
              {(candidateAvg - baselineAvg) > 0 ? '+' : ''}{(candidateAvg - baselineAvg).toFixed(3)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Recommendation + Deploy */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #333',
      }}>
        <span style={{ fontSize: '12px', color: recColor }}>
          Recommendation: {(run.recommendation || 'unknown').replace(/_/g, ' ').toUpperCase()}
        </span>
        {run.winner === 'candidate' && (
          <button
            onClick={onDeploy}
            disabled={deploying}
            style={{
              padding: '6px 16px', background: '#14532d', color: '#4ade80',
              border: '1px solid #22c55e', borderRadius: '6px', cursor: deploying ? 'wait' : 'pointer',
              fontSize: '12px', fontWeight: 600,
            }}
          >
            {deploying ? 'Deploying...' : 'Deploy Candidate'}
          </button>
        )}
      </div>
    </div>
  )
}
