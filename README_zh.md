# Prompt Manager（提示词管理器）

[English](./README.md) | **中文文档**

Prompt Manager 是一个围绕提示词研发流程打造的全栈平台：后端使用 FastAPI + MongoDB 提供异步 API，前端使用 React + TypeScript 构建交互界面。项目支持提示词项目管理、版本追踪、差异对比、AI 智能优化以及实时流式测试，帮助团队安全地沉淀和复用优质 Prompt。

![alt text](image.png)
![alt text](image-1.png)
![alt text](image-2.png)
![alt text](image-3.png)

## 功能特性

- **项目空间**：将提示词划分到不同项目，并维护描述与元信息。
- **自动版本控制**：每次保存都会生成新版本，保留时间戳与内容快照。
- **可视化 Diff**：直观对比不同版本的差异，支持回滚。
- **提示词测试台**：内置 Playground，支持自定义消息、拖拽排序与 SSE 流式响应。
- **AI 智能优化**：调用阿里云百炼或兼容 OpenAI 的模型生成优化建议，可在弹窗中二次编辑。
- **标签 / 分类管理**：专用后台页维护标签与分类，便于筛选。
- **导入导出**：支持 JSON / YAML 备份和迁移。
- **集成教程**：提供示例与 API 文档，帮助快速接入业务系统。

## 技术栈

### 后端
- **语言 / 运行时**：Python 3.10+
- **框架**：FastAPI + Uvicorn
- **数据库**：MongoDB（Motor 异步驱动）
- **核心库**：Pydantic v2、SSE-Starlette、diff-match-patch

### 前端
- **框架**：React + TypeScript
- **构建工具**：Vite
- **样式**：Tailwind CSS
- **状态管理**：Zustand
- **路由与图标**：React Router、Lucide React

## 项目结构

```
prompt-manager/
├── AGENTS.md                # 贡献者指南 / 开发协议
├── README.md / README_zh.md # 文档（英文 / 中文）
├── backend_fastapi/         # FastAPI 后端
│   ├── pyproject.toml       # 依赖声明
│   └── src/app/             # 配置、Router、Service、Model、Schema
├── frontend/                # Vite + React 前端
│   ├── public/              # 静态资源
│   └── src/                 # 组件、页面、服务、Zustand Store
└── image*.png               # 文档截图
```

## 环境要求

- Python **3.10+**
- MongoDB **6.x+**（本地或远程实例）
- Node.js **18+** 与 npm

## 后端启动 (`backend_fastapi`)

```bash
cd backend_fastapi
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
```

在 `backend_fastapi/.env` 中配置环境变量（如下为默认值）：

```env
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
MONGO_URI=mongodb://localhost:27017
MONGO_DB=prompt_manager
ALIYUN_API_KEY=
ALIYUN_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ALIYUN_MODEL=qwen-turbo
ALIYUN_SYSTEM_PROMPT=
CORS_ALLOW_ORIGINS=*
# FRONTEND_DIST_PATH=/opt/frontend-dist  # 可选覆盖，默认指向 ../frontend/dist
```

启动 FastAPI 服务：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8080 --app-dir src
```

运行后端测试：

```bash
pytest
```

## 前端启动 (`frontend`)

```bash
cd frontend
npm install
npm run dev    # 启动 Vite 开发服务器（含 API 代理）
npm run lint   # ESLint + React hooks 检查
npm run check  # TypeScript project references
npm run build  # 生成生产构建
```

默认情况下，前端监听 `http://localhost:5173`，并通过代理转发接口到 `http://localhost:8080`。

如需在本地使用其他后端地址，可在 `frontend/.env.local` 中设置 `VITE_BACKEND_URL`（或在启动命令前导出变量）：

```bash
echo "VITE_BACKEND_URL=http://localhost:9090" > frontend/.env.local
npm run dev
```

> 若希望后端一站式提供 UI，请在开发或部署前运行一次 `npm run build`。FastAPI 会根据默认 `FRONTEND_DIST_PATH` 自动挂载 `frontend/dist`，访问 `http://localhost:8080` 即可加载 SPA，同时 `/api/...` 仍返回 JSON。

## 生产部署

1. **构建前端静态资源**
   ```bash
   cd frontend
   npm install
   npm run build
   ```
   构建结果位于 `frontend/dist`，将其上传到生产服务器（如 `/opt/prompt-manager/frontend-dist`）。

2. **默认由 FastAPI 托管静态资源**
- 在项目结构未变的情况下，只要存在 `frontend/dist`，后端就会自动将其挂载到 `/`，`/api` 仍用于 JSON/SSE。
- 如果构建产物存放在其他目录，可通过 `FRONTEND_DIST_PATH` 指向新的绝对路径。
- 挂载静态资源时已内置 SPA fallback，刷新 `/project/<id>` 等前端路由会自动返回 `index.html`。
- 若希望交由 CDN / 独立站点托管前端，只需把 `FRONTEND_DIST_PATH` 设为空（或删除该变量），由前端站点请求后端 `/api`。

3. **配置 CORS**
   - `CORS_ALLOW_ORIGINS` 支持逗号分隔的多个域名，例如：`CORS_ALLOW_ORIGINS=https://prompt.example.com,https://ops.example.com`。
   - 若前端与后端同域部署（方式 A），建议把 `*` 替换为实际域名以提升安全性。

4. **以服务方式运行 FastAPI**
   ```bash
   cd backend_fastapi
   source .venv/bin/activate
   uvicorn app.main:app --host 0.0.0.0 --port 8080 --app-dir src --workers 4
   ```
   在生产中可使用 `systemd`、Supervisor 或 Docker 来管理进程，并通过 Nginx/Caddy 终止 TLS，再把请求转发到 `http://127.0.0.1:8080`。

5. **MongoDB 与环境变量**
   - `MONGO_URI` 指向云端数据库时，确保网络与权限安全。
   - `.env` 只应保存在服务器上，勿提交仓库，定期轮换 API Key。

部署后若需调整端口或域名，只需修改后端 `.env`（如 `SERVER_PORT`）或反向代理配置；前端会根据 `window.location.origin` 自动请求当前站点的 `/api`。只有在前端与后端分域托管时，才需要在构建前修改 `frontend/public/config.js`（或自定义 `config.js`）以覆盖 `window.ENV.API_URL`。

## API 概览

FastAPI 服务在 `/api` 下提供 REST + SSE 接口：

- `GET /api/projects` / `POST /api/projects`：项目列表与创建。
- `GET /api/projects/{project_id}/prompts` / `POST ...`：查询或新增某项目内的提示词版本。
- `GET /api/prompts/{prompt_id}` / `PUT ...`：获取或更新单个版本（支持创建新版本）。
- `GET /api/prompts/{prompt_id}/diff/{target_id}`：返回 HTML Diff 结果。
- `POST /api/prompts/{prompt_id}:optimize`：触发优化并以 SSE 流返回。
- `POST /api/prompts/{prompt_id}:test`：Playground 测试会话（SSE）。
- `GET/POST /api/settings`：系统配置（模型、API Key）。
- `GET /api/tags`、`GET /api/categories`、`GET /api/export`：标签、分类及导出能力。

启动后可访问 `http://localhost:8080/docs` 获取完整 OpenAPI 文档。

## 开发小贴士

- `.env` 文件应位于 `backend_fastapi/` 与 `frontend/` 内，切勿提交到仓库。
- SSE 响应统一为 `{ text: string }`，新增流时可复用现有工具函数。
- 如果扩展新的模型供应商，请在后端 `Settings` 中定义环境变量，并通过 `/api/settings` 暴露到前端。
