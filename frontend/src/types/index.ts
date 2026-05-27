export interface FileRecord {
  id: string
  filename: string
  file_type: 'text' | 'ems' | 'xml' | 'unknown'
  file_size: number
  is_empty: boolean
}

export interface EMSEvent {
  date: string
  hostname: string
  level: 'emergency' | 'alert' | 'error' | 'warning' | 'notice' | 'info' | 'debug'
  operation: string
  summary: string
  content: string
}

export interface SessionMeta {
  sessionId: string
  serialNum: string
  generatedOn: string
  nodeColor: 'blue' | 'orange'
}

export interface Cluster {
  id: string
  node_count: number
  last_seen: string
  nodes: { id: string; hostname: string; serial_num: string; session_count: number }[]
}

export interface Session {
  id: string
  generated_on: string
  uploaded_at: string
  os_version: string
  original_filename: string
  file_count: number
  status: string
  group_id?: string
}
