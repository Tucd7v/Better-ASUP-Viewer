import type { Tab } from './ViewerPage'

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
}

export default function TabBar({ tabs, activeTabId, onSelect, onAdd, onClose }: TabBarProps) {
  return (
    <div className="tab-bar nodrag" style={{
      display: 'flex', alignItems: 'center', background: '#f1f5f9',
      borderBottom: '1px solid #e2e8f0', height: 32, flexShrink: 0,
      fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace',
      overflowX: 'auto', overflowY: 'hidden',
    }}>
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 12px', height: '100%', cursor: 'pointer',
            background: tab.id === activeTabId ? '#fff' : 'transparent',
            borderBottom: tab.id === activeTabId ? '2px solid #3b82f6' : '2px solid transparent',
            color: tab.id === activeTabId ? '#1e293b' : '#64748b',
            fontWeight: tab.id === activeTabId ? 600 : 400,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {tab.isAutoAI && <span style={{ fontSize: 11 }}>🤖</span>}
          <span>{tab.name}</span>
          {tabs.length > 1 && (
            <span
              onClick={e => { e.stopPropagation(); onClose(tab.id) }}
              style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1, padding: '0 2px', cursor: 'pointer' }}
            >×</span>
          )}
        </div>
      ))}
      <button
        onClick={onAdd}
        style={{
          marginLeft: 'auto', padding: '0 10px', height: '100%',
          background: 'none', border: 'none', color: '#64748b',
          cursor: 'pointer', fontSize: 16, flexShrink: 0,
        }}
        title="New tab"
      >+</button>
    </div>
  )
}
