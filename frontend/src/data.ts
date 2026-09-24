import {
  Cpu,
  Code,
  PenTool,
  Coffee,
  Search,
  BookOpen,
  Briefcase,
  Flame,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export interface Category {
  id: string;
  name: string;
  icon: LucideIcon;
}

export interface Tool {
  id: string;
  name: string;
  url: string;
  desc: string;
  categoryId: string;
}

export interface DiscoverColumn {
  id: string;
  name: string;
  desc: string;
  icon: LucideIcon;
}

export const categories: Category[] = [
  { id: 'search', name: '搜索引擎', icon: Search },
  { id: 'ai', name: 'AI 工具', icon: Cpu },
  { id: 'dev', name: '开发助手', icon: Code },
  { id: 'design', name: '设计资源', icon: PenTool },
  { id: 'work', name: '办公效率', icon: Briefcase },
  { id: 'learn', name: '学习充电', icon: BookOpen },
  { id: 'relax', name: '休闲娱乐', icon: Coffee },
];

export const discoverColumns: DiscoverColumn[] = [
  { id: 'trending', name: '热门推荐', desc: '大家都在用的热门工具', icon: Flame },
  { id: 'newest', name: '最近更新', desc: '新收录的工具和资源', icon: Sparkles },
  { id: 'picked', name: '精选合集', desc: '编辑精选的实用工具集', icon: TrendingUp },
];

export const tools: Tool[] = [
  // 搜索引擎
  { id: 'google', name: 'Google', url: 'https://google.com', desc: '全球最大的搜索引擎', categoryId: 'search' },
  { id: 'bing', name: 'Bing', url: 'https://bing.com', desc: '微软提供的搜索引擎', categoryId: 'search' },
  { id: 'baidu', name: '百度', url: 'https://baidu.com', desc: '最大的中文搜索引擎', categoryId: 'search' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com', desc: '保护隐私的搜索引擎', categoryId: 'search' },

  // AI 工具
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chat.openai.com', desc: 'OpenAI 强大的 AI 对话模型', categoryId: 'ai' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', desc: 'Anthropic 的智能 AI 助手', categoryId: 'ai' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', desc: 'Google 的下一代多模态 AI 模型', categoryId: 'ai' },
  { id: 'midjourney', name: 'Midjourney', url: 'https://www.midjourney.com', desc: '高质量 AI 图像生成工具', categoryId: 'ai' },

  // 开发助手
  { id: 'github', name: 'GitHub', url: 'https://github.com', desc: '全球最大的代码托管平台', categoryId: 'dev' },
  { id: 'stackoverflow', name: 'Stack Overflow', url: 'https://stackoverflow.com', desc: '开发者问答社区', categoryId: 'dev' },
  { id: 'vercel', name: 'Vercel', url: 'https://vercel.com', desc: '现代 Web 应用部署平台', categoryId: 'dev' },
  { id: 'mdn', name: 'MDN Web Docs', url: 'https://developer.mozilla.org', desc: '权威的 Web 开发文档', categoryId: 'dev' },

  // 设计资源
  { id: 'figma', name: 'Figma', url: 'https://figma.com', desc: '协作式界面设计工具', categoryId: 'design' },
  { id: 'dribbble', name: 'Dribbble', url: 'https://dribbble.com', desc: '全球顶尖设计作品展示平台', categoryId: 'design' },
  { id: 'pexels', name: 'Pexels', url: 'https://pexels.com', desc: '免费高清无版权图片库', categoryId: 'design' },
  { id: 'iconfont', name: 'Iconfont', url: 'https://www.iconfont.cn', desc: '阿里巴巴矢量图标库', categoryId: 'design' },

  // 办公效率
  { id: 'notion', name: 'Notion', url: 'https://notion.so', desc: '多合一的知识管理与协作工作区', categoryId: 'work' },
  { id: 'feishu', name: '飞书', url: 'https://feishu.cn', desc: '先进的企业协同办公平台', categoryId: 'work' },
  { id: 'processon', name: 'ProcessOn', url: 'https://processon.com', desc: '免费在线作图工具', categoryId: 'work' },

  // 学习充电
  { id: 'coursera', name: 'Coursera', url: 'https://coursera.org', desc: '提供顶尖大学课程的在线学习平台', categoryId: 'learn' },
  { id: 'bilibili_learn', name: 'Bilibili', url: 'https://bilibili.com', desc: '除了娱乐，也是最大的学习视频网站', categoryId: 'learn' },
  { id: 'duolingo', name: '多邻国', url: 'https://www.duolingo.cn', desc: '免费有趣的语言学习应用', categoryId: 'learn' },

  // 休闲娱乐
  { id: 'youtube', name: 'YouTube', url: 'https://youtube.com', desc: '全球最大的视频分享平台', categoryId: 'relax' },
  { id: 'spotify', name: 'Spotify', url: 'https://spotify.com', desc: '流行的正版流媒体音乐服务平台', categoryId: 'relax' },
  { id: 'douban', name: '豆瓣', url: 'https://douban.com', desc: '书籍、电影、音乐发现与评价社区', categoryId: 'relax' },
];
