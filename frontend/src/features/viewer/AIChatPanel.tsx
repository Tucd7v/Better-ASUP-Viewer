import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useViewer } from './ViewerContext'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: { tool: string; args: Record<string, unknown> }[]
  toolResults?: { tool: string; result: unknown }[]
}

interface AIChatPanelProps {
  sessionIds: string[]
  groupSessions: { id: string; hostname?: string; serialNum?: string; color: 'blue' | 'orange' }[]
  onFocusFile: (fileId: string) => void
  onClose?: () => void
  contextFileIds?: string[]
  presetMessage?: string
}

export default function AIChatPanel({ sessionIds, groupSessions, onFocusFile, onClose, contextFileIds, presetMessage }: AIChatPanelProps) {
  const { dispatch } = useViewer()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingLines, setStreamingLines] = useState<string[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-send presetMessage when panel opens with context files
  useEffect(() => {
    if (presetMessage && messages.length === 0 && !loading) {
      handleSend(presetMessage)
    }
  }, [presetMessage])

  const handleSend = async (text?: string) => {
    const userMsg = (text ?? input).trim()
    if (!userMsg || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)
    setStreamingLines(['正在分析...'])

    try {
      const baseUrl = (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? ''
      const resp = await fetch(`${baseUrl}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_ids: sessionIds, message: userMsg, ...(contextFileIds?.length ? { context_file_ids: contextFileIds } : {}) }),
      })

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''

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
                setStreamingLines(prev => [...prev, `💬 ${event.message}`])
                break

              case 'tool_call': {
                const callDesc =
                  event.tool === 'search_logs'
                    ? `🔍 搜索: "${(event.args as Record<string, string>)?.query}"${(event.args as Record<string, string>)?.file_type ? ' (' + (event.args as Record<string, string>).file_type + ')' : ''}`
                    : event.tool === 'read_file'
                      ? '📄 读取文件...'
                      : event.tool === 'lookup_concept'
                        ? '🔎 查询 ONTAP 概念...'
                        : event.tool === 'find_files'
                          ? '📁 搜索文件...'
                          : `⚙️ ${event.tool}`
                setStreamingLines(prev => [...prev, callDesc])
                break
              }

              case 'tool_result':
                // Auto-open files on canvas
                {
                  const fileIds: string[] = []
                  const collectFileId = (rec: Record<string, unknown>) => {
                    const fid = rec.file_id as string | undefined
                    if (fid && !fileIds.includes(fid)) {
                      fileIds.push(fid)
                      dispatch({ type: 'SHOW_FILE', fileId: fid })
                      onFocusFile(fid)
                    }
                  }
                  if (event.result && Array.isArray(event.result)) {
                    for (const r of event.result) {
                      collectFileId(r as Record<string, unknown>)
                    }
                  } else if (event.result && typeof event.result === 'object') {
                    collectFileId(event.result as Record<string, unknown>)
                  }
                }
                break

              case 'done':
                setMessages(prev => [...prev, { role: 'assistant', content: event.answer || '' }])
                break

              case 'error':
                setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${event.message}` }])
                break
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ 连接失败: ${msg}` }])
    } finally {
      setLoading(false)
      setStreamingLines([])
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
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 0.4; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.1); } }
        .markdown-body table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
        .markdown-body th, .markdown-body td { border: 1px solid #e2e8f0; padding: 4px 8px; text-align: left; }
        .markdown-body th { background: #f8fafc; font-weight: 600; }
        .markdown-body code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 11px; font-family: monospace; }
        .markdown-body pre { background: #1e293b; color: #e2e8f0; padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 11px; }
        .markdown-body pre code { background: none; padding: 0; color: inherit; }
        .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin: 8px 0 4px; }
        .markdown-body ul, .markdown-body ol { padding-left: 20px; margin: 4px 0; }
        .markdown-body strong { color: #1e293b; }
        .markdown-body hr { border: none; border-top: 1px solid #e2e8f0; margin: 8px 0; }
      `}</style>
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
            background: msg.role === 'user' ? '#eff6ff' : '#f8fafc',
            borderRadius: 8, padding: '8px 12px', fontSize: 14, lineHeight: 1.6,
            color: '#1e293b', maxWidth: '100%', wordBreak: 'break-word',
            border: msg.role === 'user' ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
          }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>
              {msg.role === 'user' ? '你' : 'AI'}
            </div>
            {msg.role === 'assistant' ? (
              <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.7 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div style={{
            background: '#f8fafc', borderRadius: 8, padding: '10px 14px',
            border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              AI
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: '#3b82f6', animation: 'pulse 0.8s ease-in-out infinite',
              }} />
            </div>
            {streamingLines.map((line, i) => (
              <div key={i} style={{
                fontSize: 12, color: i === 0 ? '#3b82f6' : '#64748b',
                fontFamily: 'monospace', opacity: i === streamingLines.length - 1 ? 1 : 0.6,
              }}>
                {line}
              </div>
            ))}
          </div>
        )}
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
