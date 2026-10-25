#!/usr/bin/env node

import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('/Users/xiaozhuzidepingguo/.npm/_npx/705bc6b22212b352/node_modules/playwright')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(__dirname, '..')
const outDir = path.join(projectDir, 'assets', 'captures')
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const baseUrl = process.env.LINKPAD_BASE_URL || 'http://127.0.0.1:3000'
const apiBase = 'https://linkpad.site'
const repoId = '44aabffa-4f6b-49ff-9105-59fd2462723e'
const lockedCategory = '私藏灵感'
const lockedPassword = 'linkpad'

const demoUser = {
  id: 'demo-linkpad-user',
  email: 'demo@linkpad.site',
  nickname: 'LinkPad 体验官',
  avatar_url: `${apiBase}/api/avatars/ab02b947-a1e4-41e3-9b8a-040b61eedbb6.jpg`,
}

const now = new Date('2026-10-19T15:25:05+08:00')

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Lang',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  }
}

async function proxyImage(route, remoteUrl) {
  try {
    const response = await fetch(remoteUrl)
    if (!response.ok) return route.fulfill({ status: response.status, body: '' })
    return route.fulfill({
      status: 200,
      contentType: response.headers.get('content-type') || 'image/png',
      headers: { 'Cache-Control': 'no-store' },
      body: Buffer.from(await response.arrayBuffer()),
    })
  } catch {
    return route.fulfill({ status: 502, body: '' })
  }
}

async function loadJson(name) {
  return JSON.parse(await readFile(path.join('/tmp', name), 'utf8'))
}

async function main() {
  await mkdir(outDir, { recursive: true })

  const [repos, categories, tools, repo, repoLinks] = await Promise.all([
    loadJson('linkpad-repos.json'),
    loadJson('linkpad-categories.json'),
    loadJson('linkpad-tools-live.json'),
    loadJson('linkpad-repo.json'),
    loadJson('linkpad-repo-links.json'),
  ])

  const demoRepos = repos.slice(0, 4).map((item) => ({ ...item, is_following: false, is_bookmarked: false }))
  const categoriesWithLock = [
    ...categories,
    {
      id: 'demo-private-inspiration',
      name: lockedCategory,
      icon: 'Gem',
      parent_id: '',
      sort_order: categories.length,
      password: lockedPassword,
    },
  ]

  const lockedTools = [
    {
      id: 'demo-locked-1',
      name: '灵感采集',
      url: 'https://www.are.na/',
      desc: '把散落的灵感收进同一张画布',
      category_id: 'demo-private-inspiration',
      created_at: '2026-10-18 09:20:00',
      sort_order: 0,
      icon: 'https://linkpad.site/api/favicon-img/7777772e6172652e6e612e706e67',
      bg_color: '#3B82F6',
      text_color: '#FFFFFF',
    },
    {
      id: 'demo-locked-2',
      name: 'Reference',
      url: 'https://www.reference.gallery/',
      desc: '视觉参考与版式研究',
      category_id: 'demo-private-inspiration',
      created_at: '2026-10-18 09:21:00',
      sort_order: 1,
      icon: 'https://linkpad.site/api/favicon-img/7777772e7265666572656e63652e67616c6c6572792e706e67',
      bg_color: '#8B5CF6',
      text_color: '#FFFFFF',
    },
    {
      id: 'demo-locked-3',
      name: 'Mobbin',
      url: 'https://mobbin.com/',
      desc: '真实产品界面库',
      category_id: 'demo-private-inspiration',
      created_at: '2026-10-18 09:22:00',
      sort_order: 2,
      icon: 'https://linkpad.site/api/favicon-img/6d6f6262696e2e636f6d.png',
      bg_color: '#EC4899',
      text_color: '#FFFFFF',
    },
  ]

  const todos = [
    { id: 'demo-todo-1', content: '整理本周产品灵感', is_completed: 0, created_at: '2026-10-19 09:10:00' },
    { id: 'demo-todo-2', content: '补充竞品分析资料', is_completed: 0, created_at: '2026-10-19 09:11:00' },
    { id: 'demo-todo-3', content: '更新团队仓库', is_completed: 1, created_at: '2026-10-19 09:12:00' },
  ]

  const widgets = [
    { id: 'demo-clock', type: 'clock', name: '时间' },
    { id: 'demo-search', type: 'search', name: '搜索框', channel: 'local' },
    { id: 'demo-todo', type: 'todo', name: '待办事项', height: 2, category_id: 'demo-private-inspiration' },
  ]

  let followed = false
  let followedRepos = []

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
  })

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
  })

  await context.addInitScript(({ user, fixedNow, api }) => {
    localStorage.setItem('linkpad_token', 'demo-linkpad-token')
    localStorage.setItem('linkpad_user_cache', JSON.stringify(user))
    localStorage.setItem('linkpad_welcome_shown', '1')
    localStorage.setItem('lang', 'zh')
    localStorage.setItem('wallpaper', '/wallpapers/w1.jpg')
    localStorage.setItem('search_channel', 'local')
    localStorage.setItem('sidebar_collapsed', '0')
    localStorage.setItem('sticky_top_widgets', '1')
    localStorage.setItem('widgets', JSON.stringify([
      { id: 'demo-clock', type: 'clock', name: '时间' },
      { id: 'demo-search', type: 'search', name: '搜索框', channel: 'local' },
      { id: 'demo-todo', type: 'todo', name: '待办事项', height: 2, category_id: 'demo-private-inspiration' },
    ]))

    const absoluteAsset = (value) => {
      if (typeof value !== 'string' || !value.startsWith('/api/')) return value
      return `${api}${value}`
    }
    const nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (typeof input === 'string' && input.startsWith('/api/')) input = `${api}${input}`
      return nativeFetch(input, init)
    }
    const nativeBeacon = navigator.sendBeacon?.bind(navigator)
    if (nativeBeacon) {
      navigator.sendBeacon = (url, data) => nativeBeacon(
        typeof url === 'string' && url.startsWith('/api/') ? `${api}${url}` : url,
        data,
      )
    }
    new MutationObserver(() => {
      document.querySelectorAll('img[src^="/api/"]').forEach((img) => {
        img.src = absoluteAsset(img.getAttribute('src'))
      })
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })

    const RealDate = Date
    class FixedDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]))
      }
      static now() {
        return new RealDate(fixedNow).getTime()
      }
    }
    window.Date = FixedDate
  }, { user: demoUser, fixedNow: now.toISOString(), api: apiBase })

  const api = async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    const method = request.method()

    if (method === 'OPTIONS') return route.fulfill(json({}, 204))

    if (pathname === '/api/auth/me') return route.fulfill(json(demoUser))
    if (pathname === '/api/categories') return route.fulfill(json(categoriesWithLock))
    if (pathname === '/api/tools') return route.fulfill(json([...tools, ...lockedTools]))
    if (pathname === '/api/discover') {
      return route.fulfill(json([
        { id: 'newest', name: '最近更新', desc: '新收录的工具和资源', icon: 'Sparkles' },
        { id: 'picked', name: '精选合集', desc: '编辑精选的实用工具集', icon: 'TrendingUp' },
        { id: 'trending', name: '热门推荐', desc: '大家都在用的热门工具', icon: 'Flame' },
      ]))
    }
    if (pathname === '/api/discover/repos') {
      return route.fulfill(json(demoRepos.map((item) => (
        item.id === repoId ? { ...item, is_following: followed, follower_count: followed ? item.follower_count + 1 : item.follower_count } : item
      ))))
    }
    if (pathname === `/api/repos/${repoId}`) {
      return route.fulfill(json({
        ...repo,
        is_following: followed,
        follower_count: followed ? repo.follower_count + 1 : repo.follower_count,
        can_manage: true,
      }))
    }
    if (pathname === `/api/repos/${repoId}/links`) {
      if (method === 'POST') {
        return route.fulfill(json({ success: true }))
      }
      return route.fulfill(json(repoLinks))
    }
    if (pathname === '/api/repos') return route.fulfill(json(demoRepos))
    if (pathname === '/api/me/followed-repos') return route.fulfill(json(followedRepos))
    if (pathname === '/api/me/bookmarked-repos') return route.fulfill(json([]))
    if (pathname === '/api/user/widgets') {
      if (method === 'POST') return route.fulfill(json({ success: true }))
      return route.fulfill(json({ widgets, itemOrder: {}, countdownEvents: [] }))
    }
    if (pathname === '/api/todos') {
      if (method === 'POST') return route.fulfill(json({ id: `demo-todo-${Date.now()}`, content: '新的待办事项', is_completed: 0 }))
      return route.fulfill(json(todos))
    }
    if (pathname.startsWith('/api/todos/')) {
      return route.fulfill(json({ success: true }))
    }
    if (pathname === '/api/notifications') return route.fulfill(json({ notifications: [], unread_count: 0 }))
    if (pathname === '/api/notifications/read') return route.fulfill(json({ success: true }))
    if (pathname === '/api/wallpapers') return route.fulfill(json([]))
    if (pathname === '/api/tools/check') return route.fulfill(json({ checked: 0, dead: [] }))
    if (pathname === `/api/repos/${repoId}/links/check`) return route.fulfill(json({ checked: 0, dead: [] }))
    if (pathname === `/api/repos/${repoId}/links/duplicates`) return route.fulfill(json({ duplicates: [], matchType: 'exact' }))
    if (pathname === '/api/favicon') {
      return route.fulfill(json({ icon_url: `${apiBase}/api/favicon-img/6c696e6b7061642e73697465.png` }))
    }
    if (pathname === '/api/link-meta') {
      return route.fulfill(json({
        title: 'Linear',
        description: 'Linear helps teams plan and build products with a fast, focused issue tracker.',
        site_name: 'Linear',
      }))
    }
    if (pathname.startsWith('/api/admin/')) return route.fulfill(json({ isAdmin: false }))
    if (pathname === `/api/follows/repo/${repoId}/duplicates`) return route.fulfill(json({ duplicates: [] }))
    if (pathname === `/api/follows/repo/${repoId}`) {
      if (method === 'POST') {
        followed = true
        followedRepos = [demoRepos.find((item) => item.id === repoId)].filter(Boolean)
        return route.fulfill(json({ success: true }))
      }
      if (method === 'DELETE') {
        followed = false
        followedRepos = []
        return route.fulfill(json({ success: true }))
      }
    }
    if (pathname.startsWith('/api/bookmarks/')) return route.fulfill(json({ success: true }))
    if (pathname.startsWith('/api/users/')) {
      if (pathname.endsWith('/repos')) return route.fulfill(json(demoRepos))
      if (pathname.endsWith('/followers') || pathname.endsWith('/following')) return route.fulfill(json([]))
      return route.fulfill(json({
        ...demoUser,
        follower_count: 12,
        following_count: 8,
        repo_count: 4,
        is_following: false,
      }))
    }

    return route.continue()
  }

  await context.route('https://linkpad.site/api/**', api)
  await context.route('https://linkpad.site/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().resourceType() !== 'image') return route.fallback()
    return proxyImage(route, url.toString())
  })

  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[page] ${msg.text()}`)
  })

  async function settle(ms = 700) {
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(ms)
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).filter((img) => !img.complete).map((img) => new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true })
        img.addEventListener('error', resolve, { once: true })
      })))
    })
  }

  async function shot(name, clip) {
    const options = {
      path: path.join(outDir, `${name}.png`),
      animations: 'disabled',
      caret: 'hide',
    }
    if (clip) options.clip = clip
    await page.screenshot(options)
    console.log(`captured ${name}.png`)
  }

  async function goto(pathname) {
    await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'networkidle', timeout: 60_000 })
    await settle()
  }

  await goto('/')
  await shot('01-home')

  await page.getByPlaceholder('搜索本地工具...').fill('figma')
  await page.waitForTimeout(500)
  await shot('02-search')

  await goto('/')
  const lockedHeading = page.getByRole('heading', { name: lockedCategory, exact: true })
  await lockedHeading.evaluate((el) => {
    const scroller = el.closest('main')?.querySelector('[class*="overflow-y-auto"]')
    if (scroller) scroller.scrollTop += el.getBoundingClientRect().top - 250
  })
  await settle(400)
  await shot('03-private-locked')

  const passwordInput = page.getByPlaceholder('输入密码').last()
  await passwordInput.fill(lockedPassword)
  await passwordInput.press('Enter')
  await page.waitForTimeout(400)
  await shot('04-private-unlocked')

  await goto(`/repo/${repoId}`)
  await shot('05-repo')

  await page.getByRole('button', { name: '关注', exact: true }).first().click()
  await page.waitForTimeout(250)
  await shot('06-follow-modal')

  await page.getByRole('button', { name: '确认关注' }).click()
  await page.waitForTimeout(500)
  await shot('07-followed')

  await page.getByRole('button', { name: '添加链接' }).click()
  await page.getByPlaceholder('名称').fill('Linear')
  await page.getByPlaceholder('地址（https://...）').fill('https://linear.app/')
  await page.waitForTimeout(700)
  await shot('08-add-link')

  await page.keyboard.press('Escape')
  await goto('/')
  await page.getByRole('button', { name: /^发现/ }).first().click()
  await page.getByRole('button', { name: '全部仓库', exact: true }).click()
  await page.waitForTimeout(500)
  await shot('09-discover')

  await goto('/')
  await page.getByRole('button', { name: 'LinkPad 体验官' }).click()
  await page.waitForTimeout(350)
  await shot('10-user-panel')

  await writeFile(path.join(outDir, 'capture-manifest.json'), JSON.stringify({
    capturedAt: now.toISOString(),
    baseUrl,
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    repoId,
    shots: [
      '01-home',
      '02-search',
      '03-private-locked',
      '04-private-unlocked',
      '05-repo',
      '06-follow-modal',
      '07-followed',
      '08-add-link',
      '09-discover',
      '10-user-panel',
    ],
  }, null, 2))

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
