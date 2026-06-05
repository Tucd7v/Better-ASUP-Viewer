import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' })

api.interceptors.request.use((config) => {
  console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`)
  return config
})

api.interceptors.response.use(
  (res) => {
    console.log(`[API] ${res.status} ${res.config.url}`, res.data)
    return res
  },
  (err) => {
    console.error(`[API] ERR ${err.config?.url}`, err.response?.status, err.response?.data)
    return Promise.reject(err)
  }
)

export const uploadFile = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/api/v1/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const getSessionStatus = (sessionId: string) =>
  api.get(`/api/v1/sessions/${sessionId}/status`)

export const getFiles = (sessionId: string) =>
  api.get(`/api/v1/sessions/${sessionId}/files`)

export const getFileContent = (
  sessionId: string,
  fileId: string,
  offset = 0,
  limit = 500
) => api.get(`/api/v1/sessions/${sessionId}/files/${fileId}/content`, {
  params: { offset, limit },
})

export const getClusters = (q?: string) =>
  api.get('/api/v1/clusters', { params: q ? { q } : {} })

export const getNodeSessions = (clusterId: string, nodeId: string) =>
  api.get(`/api/v1/clusters/${clusterId}/nodes/${nodeId}/sessions`)

export const getClusterGroups = (clusterId: string) =>
  api.get(`/api/v1/clusters/${clusterId}/groups`)

export const getSessionGroup = (groupId: string) =>
  api.get(`/api/v1/session-groups/${groupId}`)

export const getClusterOverview = (clusterId: string) =>
  api.get(`/api/v1/clusters/${clusterId}/overview`)

export const deleteSession = (sessionId: string) =>
  api.delete(`/api/v1/sessions/${sessionId}`)

export default api


export const getTemplates = (params?: { sessionId?: string; groupId?: string }) =>
  api.get('/api/v1/templates', { params })

export const getTemplate = (id: string) =>
  api.get(`/api/v1/templates/${id}`)

export const createTemplate = (data: {
  name: string
  session_id?: string
  group_id?: string
  split_mode?: boolean
  cards: {
    file_id: string
    session_id: string
    filename: string
    node_index: number
    pos_x: number
    pos_y: number
    collapsed: boolean
    splitMode?: boolean
    split_mode?: boolean
  }[]
  edges: { edge_id: string; source_file_id: string; target_file_id: string; label?: string | null }[]
}) => api.post('/api/v1/templates', data)

export const deleteTemplate = (id: string) =>
  api.delete(`/api/v1/templates/${id}`)

export const searchFiles = (sessionId: string, q: string, limit = 50) =>
  api.get('/api/v1/search', { params: { session_id: sessionId, q, limit } })
