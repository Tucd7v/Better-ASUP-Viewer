import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: { tool: string; args: Record<string, unknown> }[]
  toolResults?: { tool: string; result: unknown }[]
}

interface AIChatPanelProps {
  sessionId: string
  groupSessions: { id: string }[]
  onFocusFile: (fileId: string) => void
  onClose?: () => void
}

export default function AIChatPanel({ sessionId, groupSessions, onFocusFile, onClose }: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (text?: string) => {
    const userMsg = (text ?? input).trim()
    if (!userMsg || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    // Add placeholder assistant message
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const baseUrl = (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? ''
      const resp = await fetch(`${baseUrl}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: userMsg }),
      })

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''
      const currentToolCalls: { tool: string; args: Record<string, unknown> }[] = []
      const currentResults: { tool: string; result: unknown }[] = []
      let assistantContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string
              message?: string
              tool?: string
              args?: Record<string, unknown>
              result?: unknown
              answer?: string
            }

            switch (event.type) {
              case 'status':
                assistantContent += event.message + '\n'
                setMessages(prev => {
                  const last = prev[prev.length - 1]
                  if (last?.role !== 'assistant') return prev
                  return [...prev.slice(0, -1), { ...last, content: assistantContent, toolCalls: currentToolCalls, toolResults: currentResults }]
                })
                break

              case 'tool_call': {
                const tc = { tool: event.tool!, args: event.args || {} }
                currentToolCalls.push(tc)
                const callDesc =
                  event.tool === 'search_logs'
                    ? `🔍 搜索: "${(event.args as Record<string, string>)?.query}"${(event.args as Record<string, string>)?.file_type ? ' (' + (event.args as Record<string, string>).file_type + ')' : ''}`
                    : event.tool === 'read_file'
                      ? '📄 读取文件...'
                      : `⚙️ ${event.tool}`
                assistantContent += callDesc + '\n'
                setMessages(prev => {
                  const last = prev[prev.length - 1]
                  if (last?.role !== 'assistant') return prev
                  return [...prev.slice(0, -1), { ...last, content: assistantContent, toolCalls: currentToolCalls, toolResults: currentResults }]
                })
                break
              }

              case 'tool_result':
                currentResults.push({ tool: event.tool!, result: event.result })
                // Auto-open files on canvas
                if (event.result && Array.isArray(event.result)) {
                  const fileIds: string[] = []
                  for (const r of event.result) {
                    const record = r as Record<string, unknown>
                    if (record.file_id && !fileIds.includes(record.file_id as string)) {
                      fileIds.push(record.file_id as string)
                      onFocusFile(record.file_id as string)
                    }
                  }
                }
                break

              case 'done':
                setMessages(prev => {
                  const last = prev[prev.length - 1]
                  if (last?.role !== 'assistant') return prev
                  return [...prev.slice(0, -1), { role: 'assistant', content: event.answer || '' }]
                })
                break

              case 'error':
                setMessages(prev => {
                  const last = prev[prev.length - 1]
                  if (last?.role !== 'assistant') return prev
                  return [...prev.slice(0, -1), { role: 'assistant', content: `❌ ${event.message}` }]
                })
                break
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role !== 'assistant') return prev
        return [...prev.slice(0, -1), { role: 'assistant', content: `连接失败: ${msg}` }]
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const quickButtons = [
    '集群健康状态如何？',
    '有没有错误或告警？',
    '网络端口状态怎么样？',
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', borderLeft: '1px solid #e2e8f0' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🤖</span> AI Log Analyst
        </span>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
            <div style={{ marginBottom: 16 }}>我是 ONTAP 日志分析师，可以帮你评估集群健康状态。</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              {quickButtons.map((label) => (
                <button
                  key={label}
                  onClick={() => handleSend(label)}
                  style={{
                    background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
                    color: '#475569', cursor: 'pointer', fontSize: 11, padding: '6px 12px',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            background: msg.role === 'user' ? '#eff6ff' : msg.role === 'assistant' ? '#f8fafc' : '#fff7ed',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, lineHeight: 1.6,
            color: '#1e293b', maxWidth: '100%', wordBreak: 'break-word',
            border: msg.role === 'user' ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
          }}>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>
              {msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : ''}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            placeholder={loading ? '分析中...' : '输入问题...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            style={{
              flex: 1, padding: '6px 10px', fontSize: 12,
              border: '1px solid #e2e8f0', borderRadius: 6, outline: 'none',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              background: loading ? '#f8fafc' : '#fff',
              color: '#1e293b',
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            style={{
              background: loading ? '#94a3b8' : '#3b82f6',
              border: 'none', borderRadius: 6, color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? '...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
