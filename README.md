# LinkPad — 收藏好链接，分享好品味

一个集「极简导航首页 + 社区链接仓库」于一体的效率工具：把常用网站整理成个人导航面板，浏览器新标签页即是你的效率中心；也可以创建公开的「链接仓库」，与他人分享你的收藏和好品味。

在线体验：**https://linkpad.site**

## 功能特性

### 1. 链接仓库（核心功能）

链接仓库是 LinkPad 的灵魂功能，也是这个项目诞生的初衷。

创建一个链接合集，把相关网站添加进去，然后一键分享给其他人。仓库支持三种可见性：**公开**、**私密**、**密码保护**。

更强大的是**关注 + 自动同步**机制：其他人关注仓库后，仓库里的链接会自动出现在关注者的导航首页；后续仓库有任何更新（新增、修改、删除），都会自动同步给所有关注者——关注一次，永远最新。

实际使用场景举例：

- **团队协作**：作为产品经理，需要反复把需求/原型链接发给开发，每次开发都要来问。于是创建一个密码保护的仓库，每次新版本链接直接丢进去——开发不用再问了，打开首页就能看到最新链接。
- **同行分享**：把收藏的产品经理相关网站整理成公开仓库分享给同行，别人关注后即拥有同款导航。

### 2. 分类 / 网站加密

首页的分类和网站支持单独加密。点击加密的分类需要输入密码才能访问——隐私内容（如工作后台、个人账号）放心收藏，电脑被人借用也不怕。

### 3. 常用链接

首页最顶部的「常用链接」模块，系统自动统计你的访问频率，把最常访问的网站排在最前面。不用整理，越用越顺手。

### 4. 自动识别网站图标

提交链接后，系统自动抓取并识别网站图标（favicon），无需手动上传。收藏一个网站只需要粘贴一条 URL。

### 5. 浏览器扩展

安装浏览器扩展（Chrome / Edge）后，每次打开新标签页都会自动进入 LinkPad——新标签页就是你的导航首页，一切常用网站触手可及。

### 6. 小组件

首页支持添加实用小组件：**待办事项**、**股票行情**、**黄金价格**。导航页不只是放链接，也是你的个人信息面板。

### 7. 本地搜索

首页内置搜索栏：既可以网络搜索，也可以在收藏的链接中进行本地搜索。想找的网站搜一下就到，收藏多了也不怕。

## 发现页精选仓库

以下仓库来自 LinkPad 发现页，关注即可自动同步到你的首页：

| 仓库 | 简介 | 链接 |
| --- | --- | --- |
| 设计驿站 | 设计导航——设计师的一站式资源入口，精选优质设计工具、素材与灵感网站 | [访问](https://linkpad.site/repo/3b942eb9-95fa-4e93-aff6-11831cc28b47) |
| SEO | 汇总常用 SEO 网站、外链 | [访问](https://linkpad.site/repo/4d19583b-37bb-4232-af2f-edd90c855f98) |
| 宝藏 Github 项目 | 精选 GitHub 开源项目，帮开发者发现真正值得用的好工具 | [访问](https://linkpad.site/repo/1815f19b-8fa8-4d6f-b951-1b61fc4517b8) |
| 产品经理常用工具 | 覆盖产品经理全链路工作场景：原型、竞品分析、行业报告、数据平台、设计灵感与协作工具 | [访问](https://linkpad.site/repo/44aabffa-4f6b-49ff-9105-59fd2462723e) |
| 实用工具 | 收藏夹必备！聚合全网好用的工具网站，一个链接搞定你的所有刚需 | [访问](https://linkpad.site/repo/be3f40d8-fc6a-484d-8ebb-403e4c58ca16) |
| 独立开发工具 | VibeCoding 导航——给开发者的一站式资源清单 | [访问](https://linkpad.site/repo/3b3e75dd-bfce-48fc-9707-4665a178d8fb) |

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

[MIT](./LICENSE)
