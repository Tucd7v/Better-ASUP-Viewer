# Better ASUP Viewer

NetApp AutoSupport 日志解析、管理和分析工具。上传 `.7z` / `.tgz` 格式的 ASUP 包，自动解压、归类、分组，提供多维度查看和 AI 辅助分析。

## 功能概览

- **Manager** — 集群管理页。按集群和时间浏览上传的节点，支持搜索、分组(±20分钟窗口 HA 配对)、去重。
- **Viewer** — 日志查看器。拖拽打开 TXT/XML/EMS 文件卡片，支持关键词着色、列排序、搜索高亮、字体缩放。
- **Grid 模式** — 多卡片网格排布。拖拽替换、纯 XML 卡片自动纵向堆叠。
- **Insight** — 上传后 AI 自动扫描关键文件(sysconfig-a/r、EMS、coredump等)，生成健康摘要。
- **AI Analysis** — 侧边栏聊天式分析，支持分析模式(基于已打开文件)和自主模式(自动打开文件)。查 KB、读文件、画 Mermaid 拓扑图。
- **模板** — 保存/加载画布布局，记住 Grid/Canvas 模式。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + ReactFlow + ReactMarkdown + Mermaid |
| 后端 | Python FastAPI + SQLAlchemy (SQLite) + httpx |
| 构建 | Vite + TypeScript |
| AI | DeepSeek / OpenAI 兼容 API |

## 快速启动

### 1. 后端

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 复制配置模板
cp aiconfig.sample.yaml aiconfig.yaml
# 编辑 aiconfig.yaml，填入你的 API key 和模型配置

PYTHONPATH=backend uvicorn main:app --host 0.0.0.0 --port 8001
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev           # 开发模式 VITE:5173
```

访问 `http://localhost:5173/aisup/`。

### 生产构建

```bash
cd frontend
NODE_ENV=production node node_modules/vite/bin/vite.js build
```

构建后 `dist/` 由后端直接 serve。启动后端后访问 `http://localhost:8001/` 即可，无需额外运行前端 dev server。

`main.py` 会自动检测 `frontend/dist` 目录，挂载静态资源和 SPA 路由。

## 配置

`backend/aiconfig.yaml`:

```yaml
ai_auto_analysis:
  enabled: true          # 上传后自动 AI 分析

api:
  base_url: "https://api.deepseek.com/v1"
  model: "deepseek-chat"
  api_key: "sk-xxxx"     # 也支持环境变量 DEEPSEEK_API_KEY
```

## 目录结构

```
backend/
  api/         # FastAPI 路由
  core/        # 配置、数据库引擎
  models/      # SQLAlchemy 模型
  schemas/     # Pydantic schema
  services/    # 解析、聚类、LLM、KB搜索
  data/        # SQLite DB + 上传文件 (gitignore)
frontend/
  src/
    features/
      viewer/        # Viewer 画布、AI面板、Grid
        nodes/       # TXT/XML/EMS 卡片组件
      manager/       # Manager 集群管理
```

## License

MIT
