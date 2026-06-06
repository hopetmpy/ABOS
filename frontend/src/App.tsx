import { Routes, Route, Link, useLocation } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Budget from './pages/Budget'
import Suggestions from './pages/Suggestions'
import Forge from './pages/Forge'
import Eval from './pages/Eval'
import Deploy from './pages/Deploy'
import Memory from './pages/Memory'
import Rewards from './pages/Rewards'

const navItems = [
  { path: '/', label: 'Mission' },
  { path: '/budget', label: 'Budget' },
  { path: '/suggestions', label: 'Suggestions' },
  { path: '/forge', label: 'Forge' },
  { path: '/eval', label: 'Eval' },
  { path: '/deploy', label: 'Deploy' },
  { path: '/memory', label: 'Memory' },
  { path: '/rewards', label: 'Rewards' },
]

export default function App() {
  const location = useLocation()

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{
        width: '200px',
        padding: '20px 12px',
        borderRight: '1px solid #2a2a2a',
        background: '#141414',
      }}>
        <h2 style={{ fontSize: '14px', color: '#8b5cf6', marginBottom: '24px', letterSpacing: '0.5px' }}>
          CONWAY COCKPIT
        </h2>
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            style={{
              display: 'block',
              padding: '8px 12px',
              marginBottom: '4px',
              borderRadius: '6px',
              textDecoration: 'none',
              color: location.pathname === item.path ? '#fff' : '#888',
              background: location.pathname === item.path ? '#1f1f3a' : 'transparent',
              fontSize: '13px',
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <main style={{ flex: 1, padding: '24px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/suggestions" element={<Suggestions />} />
          <Route path="/forge" element={<Forge />} />
          <Route path="/eval" element={<Eval />} />
          <Route path="/deploy" element={<Deploy />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/rewards" element={<Rewards />} />
        </Routes>
      </main>
    </div>
  )
}
