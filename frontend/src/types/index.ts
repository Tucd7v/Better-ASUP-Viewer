export interface FileRecord {
  id: string
  filename: string
  file_type: 'text' | 'ems' | 'xml' | 'unknown'
  file_size: number
  is_empty: boolean
  sessionId?: string
  nodeColor?: string
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
  nodeColor: string
  hostname?: string
  partnerHostname?: string
  status?: string
  fileCount?: number
  clusterId?: string
}

export interface Cluster {
  id: string
  node_count: number
  last_seen: string
  files_last_24h?: number
  file_count_24h?: number
  nodes: {
    id: string
    hostname: string
    serial_num: string
    session_count: number
    file_count?: number
    last_seen?: string
    uploaded_at?: string
  }[]
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

export interface ClusterGroupMember {
  session_id: string
  serial_num: string
  hostname: string
  partner_hostname?: string
  generated_on: string | null
  original_filename: string
  file_count: number
  status: string
}

export interface ClusterGroup {
  id: string
  created_at: string
  members: ClusterGroupMember[]
}

export interface ClusterOverview {
  cluster_id: string
  last_seen: string
  groups: ClusterGroup[]
  singles: ClusterGroupMember[]
}

export interface TemplateCard {
  file_id: string
  session_id: string
  filename: string  // NEW
  node_index: number  // NEW
  pos_x: number
  pos_y: number
  collapsed: boolean
}

export interface TemplateEdge {
  edge_id: string
  source_file_id: string
  target_file_id: string
  label?: string
}

export interface CanvasTemplate {
  id: string
  name: string
  session_id?: string
  group_id?: string
  created_at: string
  updated_at: string
  cards: TemplateCard[]
  edges: TemplateEdge[]
}

export interface TemplateListItem {
  id: string
  name: string
  session_id?: string
  group_id?: string
  created_at: string
  updated_at: string
  card_count: number
}

export interface SearchMatch {
  file_id: string
  session_id: string
  filename: string
  file_type: string
  hostname?: string
  serial_num?: string
  line: number
  context: string
}

export interface SearchResponse {
  matches: SearchMatch[]
}
