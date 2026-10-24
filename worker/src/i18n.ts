// LinkPad Worker i18n：中文原文作 key，en 查字典（缺失时回退中文原文）
export type Lang = 'zh' | 'en'

// 英文语言包（API 错误消息 / SEO 文案）
export const WORKER_EN: Record<string, string> = {
  // 链接预览截图
  '无效的链接地址': 'Invalid link URL',
  '请求过于频繁，请稍后再试': 'Too many requests, please try again later',
  '预览生成失败': 'Failed to generate preview',
  // 认证 / 账户
  '未登录': 'Not signed in',
  '请输入邮箱和密码': 'Please enter email and password',
  '邮箱和密码不能为空': 'Email and password cannot be empty',
  '邮箱格式不正确': 'Invalid email format',
  '该邮箱已注册': 'This email is already registered',
  '该邮箱未注册': 'This email is not registered',
  '邮箱未注册': 'Email not registered',
  '密码至少6位': 'Password must be at least 6 characters',
  '密码错误': 'Incorrect password',
  '账户已被禁用': 'This account has been disabled',
  '用户不存在': 'User not found',
  '未找到该用户': 'User not found',
  '请提供昵称或邮箱': 'Please provide a nickname or email',
  '不能删除自己的账户': 'You cannot delete your own account',
  '不能操作自己的账户': 'You cannot operate on your own account',
  '无权修改': 'No permission to modify',
  '无权删除': 'No permission to delete',
  '无权操作': 'No permission for this action',
  '无权访问': 'No permission to access',

  // 验证码 / 邮件
  '发送太频繁，请 1 分钟后再试': 'Sending too frequently, please try again in 1 minute',
  '尝试次数过多，请重新获取验证码': 'Too many attempts, please request a new code',
  '请先获取验证码': 'Please request a code first',
  '验证码错误': 'Incorrect verification code',
  '验证码已过期，请重新获取': 'Code expired, please request a new one',
  '验证失败，请稍后再试': 'Verification failed, please try again later',
  '邮件发送失败，请稍后再试': 'Failed to send email, please try again later',
  'LinkPad 密码重置验证码': 'LinkPad Password Reset Code',
  'LinkPad 密码重置': 'LinkPad Password Reset',
  '您正在重置 LinkPad 账户密码，请使用以下验证码完成重置：': 'You are resetting your LinkPad account password. Use the code below to complete the reset:',
  '您正在重置 LinkPad 账户密码。\n\n验证码：{code}\n\n验证码 10 分钟内有效。如果这不是您本人的操作，请忽略此邮件。': 'You are resetting your LinkPad account password.\n\nVerification code: {code}\n\nThe code is valid for 10 minutes. If this wasn\'t you, please ignore this email.',
  '验证码 10 分钟内有效。如果这不是您本人的操作，请忽略此邮件。': 'The code is valid for 10 minutes. If this wasn\'t you, please ignore this email.',

  // Google 登录
  'Google 登录未配置': 'Google sign-in is not configured',
  'Google 授权失败，请重试': 'Google authorization failed, please retry',
  'Google 账号未提供邮箱': 'Google account did not provide an email',
  '获取 Google 用户信息失败，请重试': 'Failed to get Google account info, please retry',
  '登录参数缺失，请重试': 'Missing login parameters, please retry',
  '登录已超时，请重试': 'Login expired, please retry',
  '登录状态无效，请重试': 'Invalid login state, please retry',
  '登录状态校验失败，请重试': 'Login state verification failed, please retry',

  // 仓库 / 链接
  '仓库不存在': 'Repository not found',
  '链接不存在': 'Link not found',
  '仓库名称不能为空': 'Repository name cannot be empty',
  '名称不能为空': 'Name cannot be empty',
  '名称和地址不能为空': 'Name and URL cannot be empty',
  '内容不能为空': 'Content cannot be empty',
  '分类名称不能为空': 'Category name cannot be empty',
  '参数不完整': 'Incomplete parameters',
  '无效参数': 'Invalid parameters',
  '无效域名': 'Invalid domain',
  '需要 url': 'url is required',
  '仅仓库创建者可触发检测': 'Only the repository creator can trigger the check',
  '不能关注自己': 'You cannot follow yourself',
  '已关注': 'Already following',
  '未关注该仓库': 'Not following this repository',
  '关注时未选择同步分类，无法同步': 'No sync category selected when following; cannot sync',
  '已收藏': 'Already saved',
  '不能添加创建者': 'Cannot add the creator',
  '该用户已是成员': 'User is already a member',

  // 待办 / 壁纸 / 通用
  '待办事项不存在': 'Todo not found',
  '未找到': 'Not found',
  '仅支持 JPG / PNG / WebP 图片': 'Only JPG / PNG / WebP images are supported',
  '图片过大（超过 8MB）': 'Image too large (over 8MB)',
  '最多上传 30 张壁纸': 'Up to 30 wallpapers allowed',
  '壁纸不存在': 'Wallpaper not found',
  '请选择文件': 'Please select a file',
  '无效的语言': 'Invalid language',
  '同步失败': 'Sync failed',
  'API Key 已失效，请重新配置': 'API key has expired, please reconfigure',
  'API Key 无效或已失效': 'API key is invalid or expired',
  'API Key 格式不正确（应以 wrk- 开头）': 'Invalid API key format (must start with wrk-)',
}

// {name} 占位符插值
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

// Accept-Language 解析：无头（多数爬虫）默认中文
export function acceptLang(header: string | null): Lang {
  const first = (header || '').split(',')[0]?.trim().split(';')[0]?.toLowerCase() || ''
  if (!first) return 'zh'
  return first.startsWith('zh') ? 'zh' : 'en'
}

// HTML/SEO 页面语言：?lang= > cookie lang > Accept-Language > zh
export function htmlLang(url: URL | null, acceptLanguage: string | null, cookieHeader: string | null): Lang {
  const q = url?.searchParams.get('lang')?.toLowerCase()
  if (q === 'en') return 'en'
  if (q === 'zh' || q === 'zh-cn') return 'zh'
  const cookie = (cookieHeader || '').match(/(?:^|;\s*)lang=(zh|en)\b/)?.[1]
  if (cookie === 'en' || cookie === 'zh') return cookie
  return acceptLang(acceptLanguage)
}

// API 请求语言：X-Lang 头（前端携带用户选择）> Accept-Language > zh
export function apiLang(acceptLanguage: string | null, xLang: string | null): Lang {
  const x = (xLang || '').toLowerCase().trim()
  if (x === 'en' || x === 'zh') return x
  return acceptLang(acceptLanguage)
}

// 翻译助手：c 为 Hono context（读取中间件写入的 lang）
export function T(c: { get(name: string): unknown }, key: string, params?: Record<string, string | number>): string {
  const lang = c.get('lang') as Lang | undefined
  if (lang === 'en') return interpolate(WORKER_EN[key] ?? key, params)
  return interpolate(key, params)
}
