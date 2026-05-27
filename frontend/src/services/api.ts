import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' })

export const uploadFile = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/api/v1/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const getSessionStatus = (sessionId: string) =>
  api.get(`/api/v1/sessions/${sessionId}`)

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

export default api
