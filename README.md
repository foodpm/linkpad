# LinkPad — 收藏好链接，分享好品味

一个集「极简导航首页 + 社区链接仓库」于一体的效率工具：把常用网站整理成个人导航面板，浏览器新标签页即是你的效率中心；也可以创建公开的「链接仓库」，与他人分享你的收藏和好品味。

在线体验：**https://linkpad.site**

## 功能特性

- **极简导航首页**：分类收纳常用链接，拖拽排序、自定义图标、支持密码保护
- **链接仓库（Repo）**：一键创建公开/私密/密码保护的收藏仓库，分享链接给他人
- **浏览器扩展**：替换浏览器新标签页，随时访问你的导航面板（Chrome / Edge）
- **用户系统**：邮箱注册登录，数据云端同步
- **灵活的可见性控制**：仓库、分类、链接均可单独设置公开或密码保护

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 后端 API | Cloudflare Workers + [Hono](https://hono.dev/) |
| 数据库 | Cloudflare D1（SQLite） |
| 对象存储 | Cloudflare R2 |
| 前端 | React 19 + Vite + Tailwind CSS 4 |
| 浏览器扩展 | Chrome Extension (Manifest V3) |
| 认证 | JWT（HMAC-SHA256），密钥通过 Cloudflare Secrets 管理 |

## 项目结构

```
linkpad/
├── frontend/          # 前端（React + Vite）
│   └── src/
├── worker/            # 后端 API（Cloudflare Worker + Hono）
│   └── src/
├── extension/         # 浏览器扩展（新标签页）
└── wrangler.toml      # Cloudflare 部署配置
```

## 本地开发

```bash
# 1. 启动前端（http://localhost:3000，直连线上 API）
cd frontend
npm install
npm run dev

# 2. 本地启动 Worker（可选，需配置 D1/R2 绑定）
cd worker
npm install
npm run dev
```

> 前端 `frontend/src/api.ts` 中 `API_BASE` 指向后端地址，本地联调时可改为 `http://localhost:8787`。

## 部署

```bash
# 构建前端
cd frontend && npm run build

# 部署到 Cloudflare Workers
cd .. && npx wrangler deploy
```

部署前需要配置两个 Secrets（不要写在代码里）：

```bash
npx wrangler secret put JWT_SECRET    # JWT 签名密钥
npx wrangler secret put ADMIN_EMAIL   # 管理员邮箱
```

首次部署还需要初始化数据库：`cd worker && npm run db:migrate`，并按 `worker/src/migration*.sql` 顺序执行增量迁移。

## License

暂未开源许可证，保留所有权利。如需参考代码请先联系作者。
