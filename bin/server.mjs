#!/usr/bin/env node
// 通用自动化插件 · 本地网页界面服务器（v1.3.0 界面版）
// 只用 Node 内置 http 模块，零新依赖。界面是静态三件套（ui/index.html + app.js + style.css），无构建、无 CDN，离线能跑。
// 本服务器只调 lib/ 现成的函数，不改引擎逻辑；不写真实数据库、无常驻轮询；未接通的写入口与 CLI 一样明确拒绝。
import { createServer as createHttpServer } from 'node:http'
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.mjs'
import { readTemplate, proposeMapping, formatOfFile } from '../lib/template-scan.mjs'
import { DEFAULT_CONFIG, TARGETS, assertTarget, loadProfile, saveProfile, validateProfile } from '../lib/mapping-store.mjs'
import { parsePackage } from '../lib/package-parse.mjs'
import { discover, discoverCsv } from '../lib/field-discovery.mjs'
import { platformFieldMap } from '../lib/platform-fields.mjs'
import { storefrontFieldMap } from '../lib/storefront-fields.mjs'
import { buildTemplateDraft, templateToProfile, validateTemplate, parseTemplateInput } from '../lib/template-generator.mjs'
import { summarizeReminders, formatReminderSummary } from '../lib/report.mjs'
import { createFakeTarget } from '../lib/target-fake.mjs'
import { planSchedule, applySchedule, rollbackSchedule, formatInTz, toUtcMs, normalizeRules } from '../lib/schedule.mjs'
import { STANDARD_METHODS } from '../lib/api-client.mjs'
import * as adapterA from '../adapters/generic-template.mjs'
import * as adapterB from '../adapters/wander.mjs'
import * as adapterC from '../adapters/file-only.mjs'
import * as adapterD from '../adapters/douyin.mjs'
import * as adapterE from '../adapters/taobao.mjs'
import * as adapterF from '../adapters/xiaohongshu.mjs'
import * as adapterG from '../adapters/shopify.mjs'
import * as adapterH from '../adapters/woocommerce.mjs'
import * as adapterI from '../adapters/youzan.mjs'
import * as adapterJ from '../adapters/shopline.mjs'

export const UI_VERSION = '1.3.0'
export const DEFAULT_PORT = 18771
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 配置目录：默认 profiles/；测试可用 ADDON_PROFILES_DIR 指到临时目录，避免污染正式配置。
const PROFILES = process.env.ADDON_PROFILES_DIR || join(ROOT, 'profiles')
const UI_DIR = join(ROOT, 'ui')
const SAM_TEST = join(ROOT, 'sam-test')
const ADAPTERS = { 'generic-template': adapterA, wander: adapterB, 'file-only': adapterC, douyin: adapterD, taobao: adapterE, xiaohongshu: adapterF, shopify: adapterG, woocommerce: adapterH, youzan: adapterI, shopline: adapterJ }
const MAX_BODY = 10 * 1024 * 1024 // 10MB：CSV/JSON 文本够用

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const bad = (msg, status = 400) => { throw new ApiError(status, msg) }

// ---- 与 CLI 完全相同的输入处理（bin/addon.mjs 的 readRows / listImages 逻辑照抄）----
function rowsFromContent(filename, content) {
  const text = String(content ?? '')
  if (String(filename || '').toLowerCase().endsWith('.json')) {
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : data.rows
  }
  const parsed = parseCsv(text)
  const headers = parsed[0]
  if (!headers) throw new Error('CSV 为空：请检查文件内容')
  return parsed.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])))
}
function filterImageNames(names) {
  return (names || []).filter(f => /\.(png|jpe?g|webp|svg|gif)$/i.test(String(f)))
}
function validProfileName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 100 &&
    !name.includes('/') && !name.includes('\\') && name.trim() !== '.' && name.trim() !== '..'
}
function loadAndCheck(name) {
  let profile
  try { profile = loadProfile(PROFILES, name) } catch (e) { bad('配置不存在：' + name + '（' + e.message + '）', 404) }
  const errs = validateProfile(profile)
  if (errs.length) bad('配置校验失败：' + errs.join('；'))
  return profile
}
// 导入时指定专用模板：模板 JSON 文本现场转配置，不改 profiles/ 下的存量配置（与 CLI --template 同口径）。
function loadProfileOrTemplate(name, templateContent) {
  if (!templateContent) return loadAndCheck(name)
  let data
  try { data = JSON.parse(templateContent) } catch (e) { bad('模板不是有效的 JSON：' + e.message) }
  let profile
  if (Array.isArray(data.fields)) {
    const errs = validateTemplate(data)
    if (errs.length) bad('模板文件校验失败：' + errs.join('；'))
    profile = templateToProfile(data, name)
  } else if (data.mapping && typeof data.mapping === 'object') {
    profile = { ...data, profileName: name }
  } else {
    bad('文件既不是模板草稿（须有 fields 数组）也不是映射配置（须有 mapping 对象）')
  }
  const errs = validateProfile(profile)
  if (errs.length) bad('模板转配置校验失败：' + errs.join('；'))
  return profile
}
// dry-run / import-fake / file-pack 三者共用的解析＋翻译（与 CLI 同流程）。
function runParse(profile, listFilename, listContent, imageNames) {
  if (!listContent) bad('请先上传商品清单（CSV 或 JSON）')
  let rows
  try { rows = rowsFromContent(listFilename, listContent) } catch (e) { bad('清单解析失败：' + e.message) }
  if (!Array.isArray(rows) || !rows.length) bad('清单为空：至少须有一行商品')
  const files = filterImageNames(imageNames)
  const { products, errors, warnings, valid, freight } = parsePackage(rows, files, profile)
  const adapter = ADAPTERS[profile.target]
  if (!adapter) bad('未知目标：' + profile.target)
  const translated = valid ? products.map(p => adapter.translate(p, profile)) : []
  const adapterNotes = []
  translated.forEach((t, i) => {
    ;(t.notes || []).forEach(n => adapterNotes.push(`[适配提醒 ${products[i].name}] ${n}`))
    ;(t.missingRequired || []).forEach(m => adapterNotes.push(`[必填缺失 ${products[i].name}] ${m}：请补齐后再提交，缺失不得上架`))
  })
  const summary = summarizeReminders(warnings, adapterNotes)
  return { products, errors, warnings, valid, freight, translated, adapterNotes, summary }
}
function parseJsonField(v, label) {
  if (v === undefined || v === null || v === '') bad(`缺少${label}：请填入或上传`)
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch (e) { bad(`${label}不是有效的 JSON：` + e.message) }
  }
  return v
}
function scheduleInputs(body) {
  const profile = loadAndCheck(body.profile)
  const products = parseJsonField(body.statusJson, '上下架状态')
  const rules = parseJsonField(body.rulesJson, '上下架规则')
  if (!Array.isArray(products)) bad('上下架状态须为 JSON 数组')
  if (!Array.isArray(rules)) bad('上下架规则须为 JSON 数组')
  const nowMs = body.now ? toUtcMs(body.now, profile.timezone) : Date.now()
  let normalized
  try { normalized = normalizeRules(rules, profile.timezone) } catch (e) { bad('规则时间错误：' + e.message) }
  return { profile, products, rules: normalized, nowMs }
}

// ---- HTTP 工具 ----
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > MAX_BODY) { reject(new ApiError(413, '请求体超过 10MB：请拆小文件再传')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8')
      if (!text.trim()) { resolve({}); return }
      try { resolve(JSON.parse(text)) } catch (e) { reject(new ApiError(400, '请求体不是有效的 JSON：' + e.message)) }
    })
    req.on('error', () => reject(new ApiError(400, '读取请求失败')))
  })
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = resolve(UI_DIR, rel)
  if (!file.startsWith(UI_DIR + sep) || !existsSync(file) || !file.startsWith(UI_DIR)) {
    sendJson(res, 404, { ok: false, error: '找不到页面：' + pathname }); return
  }
  try {
    const data = readFileSync(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Length': data.length })
    res.end(data)
  } catch (e) { sendJson(res, 500, { ok: false, error: '读取文件失败：' + e.message }) }
}

// ---- API 路由 ----
async function handleApi(req, res, pathname, method) {
  const seg = pathname.split('/').filter(Boolean).slice(1) // 去掉 api
  const body = (method === 'POST' || method === 'PUT') ? await readBody(req) : {}
  const q = new URL(req.url, 'http://127.0.0.1').searchParams

  // POST /api/scan {filename, content} → {headers, proposal}
  if (seg[0] === 'scan' && method === 'POST') {
    let format
    try { format = formatOfFile(body.filename) } catch (e) { bad('扫描拒绝：' + e.message) }
    const { headers } = readTemplate(String(body.content ?? ''), format)
    const proposal = proposeMapping(headers)
    return { ok: true, headers, proposal, note: proposal.specDimsOverflow ? `注意：规格维 ${proposal.specDims.length} 个超过 3 维上限，请拆包或走定制适配` : '' }
  }
  // POST /api/discover {filename, content, kind?} → 发现结果
  if (seg[0] === 'discover' && method === 'POST') {
    const kind = body.kind || (String(body.filename || '').match(/\.(csv|json)$/i) ? 'csv' : 'db')
    let result
    if (kind === 'csv') {
      const format = formatOfFile(body.filename)
      result = discoverCsv(String(body.content ?? ''), format)
    } else {
      result = discover(parseJsonField(body.content, '字段文件'), kind)
    }
    return { ok: true, ...result }
  }
  // GET /api/platform-fields?platform=douyin
  if (seg[0] === 'platform-fields' && method === 'GET') {
    return { ok: true, ...platformFieldMap(q.get('platform') || '') }
  }
  // GET /api/storefront-fields?platform=shopify
  if (seg[0] === 'storefront-fields' && method === 'GET') {
    return { ok: true, ...storefrontFieldMap(q.get('platform') || '') }
  }
  // POST /api/generate-template {filename?, content?, fields?, name, target} → 模板草稿 JSON
  if (seg[0] === 'generate-template' && method === 'POST') {
    const target = body.target || 'generic-template'
    assertTarget(target)
    const name = body.name || '我的专用模板'
    let input
    if (body.fields) {
      const fields = Array.isArray(body.fields) ? body.fields.map(String) : String(body.fields).split(/[,，]/).map(s => s.trim()).filter(Boolean)
      input = { fields, rows: [], headers: fields, sourceKind: 'fields' }
    } else {
      if (!body.filename || body.content === undefined) bad('生成模板须给一个输入文件（样表 .csv / 字段清单 .json/.txt），或用 fields 直接给字段名')
      input = parseTemplateInput(String(body.content), body.filename)
    }
    const draft = buildTemplateDraft({ ...input, sourceLabel: body.filename || '直接给的字段名', name, target })
    const validationErrors = validateTemplate(draft)
    return { ok: true, draft, validationErrors }
  }
  // POST /api/templates/validate {content} → 校验模板 JSON 文本（界面编辑器用；校验不通过也是正常返回，用 ok 字段区分）
  if (seg[0] === 'templates' && seg[1] === 'validate' && method === 'POST') {
    let data
    try { data = JSON.parse(String(body.content ?? '')) } catch (e) { return { ok: false, status: 200, errors: ['模板不是有效的 JSON：' + e.message] } }
    if (!Array.isArray(data.fields)) return { ok: false, status: 200, errors: ['模板须含 fields 数组（模板草稿格式）；映射配置请走“从模板建配置”'] }
    const errors = validateTemplate(data)
    return { ok: errors.length === 0, status: 200, errors, summary: errors.length ? '' : `模板有效：字段 ${data.fields.length} 个，分类 ${data.categories?.length || 0} 个，规格维 ${data.specDims?.length || 0} 个` }
  }
  // GET /api/profiles 列表；POST /api/profiles 建配置（scan / template 两种，对应 CLI 两种 init-profile）
  if (seg[0] === 'profiles' && seg.length === 1 && method === 'GET') {
    const list = readdirSync(PROFILES).filter(f => f.endsWith('.json')).map(f => {
      const name = f.slice(0, -5)
      let target = ''
      try { target = JSON.parse(readFileSync(join(PROFILES, f), 'utf-8')).target || '' } catch { /* 读不出只给名字 */ }
      return { name, target }
    })
    return { ok: true, profiles: list }
  }
  if (seg[0] === 'profiles' && seg.length === 1 && method === 'POST') {
    const name = String(body.name || '').trim()
    if (!validProfileName(name)) bad('配置名不能为空，且不能含 / 或 \\')
    const target = body.target || 'generic-template'
    assertTarget(target)
    let profile
    if (body.mode === 'template') {
      if (body.templateContent === undefined) bad('从模板建配置须提供模板文件内容')
      let data
      try { data = JSON.parse(String(body.templateContent)) } catch (e) { bad('模板不是有效的 JSON：' + e.message) }
      if (Array.isArray(data.fields)) {
        const errs = validateTemplate(data)
        if (errs.length) bad('模板文件校验失败：' + errs.join('；'))
        profile = templateToProfile(data, name)
      } else if (data.mapping && typeof data.mapping === 'object') {
        profile = { ...data, profileName: name }
      } else {
        bad('文件既不是模板草稿（须有 fields 数组）也不是映射配置（须有 mapping 对象）')
      }
      if (body.target) profile.target = body.target
    } else {
      // 扫样表建：mapping 优先用界面核对后的版本；没给就按文件重新提议（与 CLI init-profile 相同）
      let mapping = body.mapping
      if (!mapping) {
        if (!body.filename || body.content === undefined) bad('扫样表建配置须提供样表文件，或直接传核对后的 mapping')
        const format = formatOfFile(body.filename)
        const { headers } = readTemplate(String(body.content), format)
        mapping = proposeMapping(headers)
      }
      profile = { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), profileName: name, target, mapping }
    }
    const errs = validateProfile(profile)
    if (errs.length) bad('生成拒绝：配置校验失败：' + errs.join('；'))
    saveProfile(PROFILES, name, profile)
    return { ok: true, profile, missingRequired: profile.mapping?.missingRequired || [], unmapped: profile.mapping?.unmapped || [], specDimsOverflow: !!profile.mapping?.specDimsOverflow }
  }
  // GET /api/profiles/:name；PUT /api/profiles/:name；DELETE /api/profiles/:name
  if (seg[0] === 'profiles' && seg.length === 2) {
    const name = decodeURIComponent(seg[1])
    if (!validProfileName(name)) bad('配置名不合法')
    if (method === 'GET') {
      let profile
      try { profile = loadProfile(PROFILES, name) } catch (e) { bad('配置不存在：' + name, 404) }
      return { ok: true, profile }
    }
    if (method === 'PUT') {
      const profile = { ...body, profileName: name }
      const errs = validateProfile(profile)
      if (errs.length) bad('保存拒绝：配置校验失败：' + errs.join('；'))
      saveProfile(PROFILES, name, profile)
      return { ok: true, profile }
    }
    if (method === 'DELETE') {
      const p = join(PROFILES, name + '.json')
      if (!existsSync(p)) bad('配置不存在：' + name, 404)
      unlinkSync(p)
      return { ok: true, deleted: name }
    }
  }
  // POST /api/dry-run {profile, listFilename, listContent, imageNames[], templateContent?} → 完整试跑报告
  if (seg[0] === 'dry-run' && method === 'POST') {
    const profile = loadProfileOrTemplate(body.profile, body.templateContent)
    const r = runParse(profile, body.listFilename, body.listContent, body.imageNames)
    return {
      ok: true,
      profileName: body.profile, target: profile.target,
      productCount: r.products.length, errorCount: r.errors.length,
      summary: formatReminderSummary(r.summary), reminderSummary: r.summary,
      errors: r.errors, warnings: r.warnings, adapterNotes: r.adapterNotes,
      freight: r.freight, valid: r.valid,
      firstPayload: r.translated[0]?.payload ?? null,
      conclusion: r.valid ? '只解析、只出报告，未写入任何目标（零写入）。' : '有错误，拒绝导入（零写入）。',
    }
  }
  // POST /api/import-fake 同样入参 → 模拟草稿清单；目标未接通时明确拒绝
  if (seg[0] === 'import-fake' && method === 'POST') {
    const profile = loadProfileOrTemplate(body.profile, body.templateContent)
    if (ADAPTERS[profile.target]?.CAPABILITIES?.implemented === false) {
      bad(`模拟导入拒绝：${profile.target} 平台/店铺接口未接通（只做了字段映射与接口定义），先用 dry-run 看映射，写入口待接通接口后实现`, 403)
    }
    const r = runParse(profile, body.listFilename, body.listContent, body.imageNames)
    if (!r.valid) {
      return { ok: false, error: '有错误，拒绝导入（零写入）。', errors: r.errors, warnings: r.warnings }
    }
    const target = createFakeTarget(ADAPTERS[profile.target].CAPABILITIES)
    const before = target.count()
    const drafts = r.translated.map(t => target.insertDraft(t.payload))
    return { ok: true, before, after: target.count(), drafts, note: '内存模拟，未碰真实数据库。草稿全部为 stage=pool、review=pending、onShelf=false，不直接上架。' }
  }
  // POST /api/file-pack 同样入参 → 标准商品表.csv 内容＋图片改名计划.json 内容（供下载）
  if (seg[0] === 'file-pack' && method === 'POST') {
    const profile = loadProfileOrTemplate(body.profile, body.templateContent)
    const r = runParse(profile, body.listFilename, body.listContent, body.imageNames)
    if (!r.valid) {
      return { ok: false, error: '文件包生成拒绝：有解析错误', errors: r.errors, warnings: r.warnings }
    }
    return {
      ok: true, count: r.products.length,
      sheetCsv: adapterC.renderSheet(r.products, profile),
      renamePlan: adapterC.renameImages(r.products),
    }
  }
  // POST /api/schedule-plan {profile, statusJson, rulesJson, now?} → 计划
  if (seg[0] === 'schedule-plan' && method === 'POST') {
    const { profile, products, rules, nowMs } = scheduleInputs(body)
    const plan = planSchedule(products, rules, profile.schedule, nowMs)
    return { ok: true, planTime: formatInTz(nowMs, profile.timezone), timezone: profile.timezone, ...plan }
  }
  // POST /api/schedule-demo → 执行前／执行后／回滚后／回滚一致
  if (seg[0] === 'schedule-demo' && method === 'POST') {
    const { profile, products, rules, nowMs } = scheduleInputs(body)
    const plan = planSchedule(products, rules, profile.schedule, nowMs)
    const before = products.map(p => `${p.id}:${p.onShelf}`).join(' ')
    const journal = applySchedule(products, plan)
    const after = products.map(p => `${p.id}:${p.onShelf}`).join(' ')
    const restored = rollbackSchedule(products, journal)
    const rolled = products.map(p => `${p.id}:${p.onShelf}`).join(' ')
    return { ok: true, planTime: formatInTz(nowMs, profile.timezone), timezone: profile.timezone, before, after, restored, rolled, consistent: before === rolled, actions: plan.actions, skipped: plan.skipped, alarms: plan.alarms }
  }
  // GET /api/demo → 内置演示数据（供界面“一键填入示例”）
  if (seg[0] === 'demo' && method === 'GET') {
    const imagesDir = join(SAM_TEST, 'material-pack', 'images')
    const imageNames = existsSync(imagesDir) ? readdirSync(imagesDir, { recursive: true }).filter(f => /\.(png|jpe?g|webp|svg|gif)$/i.test(String(f))).map(String) : []
    const read = (p) => readFileSync(join(SAM_TEST, p), 'utf-8')
    return {
      ok: true,
      listCsv: read('material-pack/清单.csv'), listFilename: '清单.csv',
      sampleCsv: read('other-shop/对方商城样表.csv'), sampleFilename: '对方商城样表.csv',
      statusJson: JSON.parse(read('上下架状态.json')),
      rulesJson: JSON.parse(read('上下架规则.json')),
      rulesReadableJson: JSON.parse(read('上下架规则-可读时间.json')),
      imageNames,
    }
  }
  // GET /api/onboarding → 接入流程数据（直接取各适配器的 CONNECTION_SHAPE / REQUIRED_ONBOARDING / 接口方法定义）
  if (seg[0] === 'onboarding' && method === 'GET') {
    const thirdParty = [
      { target: 'douyin', label: '抖音（抖店）', kind: 'platform', adapter: adapterD },
      { target: 'taobao', label: '淘宝', kind: 'platform', adapter: adapterE },
      { target: 'xiaohongshu', label: '小红书', kind: 'platform', adapter: adapterF },
      { target: 'shopify', label: 'Shopify', kind: 'storefront', adapter: adapterG },
      { target: 'woocommerce', label: 'WooCommerce', kind: 'storefront', adapter: adapterH },
      { target: 'youzan', label: '有赞微商城', kind: 'storefront', adapter: adapterI },
      { target: 'shopline', label: 'SHOPLINE', kind: 'storefront', adapter: adapterJ },
    ].map(({ target, label, kind, adapter }) => ({
      target, label, kind,
      implemented: adapter.CAPABILITIES?.implemented !== false,
      connectionShape: adapter.CONNECTION_SHAPE || [],
      methods: STANDARD_METHODS,
      requiredOnboarding: adapter.REQUIRED_ONBOARDING || [],
      shelf: adapter.SHELF || null,
      skuMax: adapter.CAPABILITIES?.skuMax ?? null,
    }))
    const selfHosted = [
      {
        target: 'generic-template', label: '通用商城模板（自有后台）', kind: 'self',
        ready: '字段映射与翻译已就绪：dry-run 可看每件商品翻译后的 payload（商品名、分类、颜色/尺码/图案三轴、价格分、库存、主图、运费方式与运费说明、SKU 明细）；运费按买家后台已建模板登记填写，不编默认值。',
        merchant: '商城须已部署；运费模板、分类须先在商城后台建好并登记进配置（freightTemplates）；价格单位在核对映射时确认为元或分。',
        missing: '写库层待终版：适配器只出翻译结果 payload，写入商城数据库的步骤待 Sam 中途测试反馈后做终版。接通后：写库层按 payload 字段写入，dry-run → import-fake 试跑确认草稿态，再按上下架规则配 sellableStates。',
      },
      {
        target: 'wander', label: 'WANDER 本店（自有后台）', kind: 'self',
        ready: '字段映射与翻译已就绪：与通用模板同一套 payload，差别是本店固定三维（颜色/尺码/图案），三轴皆不可为空。',
        merchant: '与通用模板相同；另注意维度不足时程序以“默认色／均码／默认款”填充并在报告里点名，须人工确认填充是否可接受。',
        missing: '写库层待终版：与通用模板相同，适配器只出 payload，写入本店数据库的步骤待终版。接通后步骤与通用模板相同。',
      },
      {
        target: 'file-only', label: '文件版（无后台）', kind: 'self',
        ready: '已完全就绪，无需任何接口：file-pack 出标准商品表.csv（固定表头，规格展平，扩展字段为 JSON 列）＋图片改名计划.json（<序号>_<角色>_<原名>）；上下架不适用。',
        merchant: '拿到两个文件后，按自己系统的导入口径手工导入；各平台列名以后台当期模板为准，须按 dry-run 的翻译结果逐列核对。',
        missing: '无：文件版设计上就不接数据库与接口，没有待接通的第三方开口。',
      },
    ]
    return { ok: true, selfHosted, thirdParty }
  }
  return { ok: false, error: '未知接口：' + pathname, status: 404 }
}

export function createServer() {
  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const pathname = decodeURIComponent(url.pathname)
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const result = await handleApi(req, res, pathname, req.method)
        const status = result.status || (result.ok ? 200 : 400)
        const { status: _s, ...out } = result
        sendJson(res, status, out)
        return
      }
      if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: '只支持 GET 访问页面' }); return }
      serveStatic(req, res, pathname)
    } catch (e) {
      // API 路由里 lib 抛出的都是输入校验错误（如未知平台、时间格式不对、JSON 解析失败），一律按 400 返回中文信息；
      // 非 API 路由的异常才按 500 处理。
      const isApi = req.url.startsWith('/api/')
      const status = e instanceof ApiError ? e.status : (isApi ? 400 : 500)
      sendJson(res, status, { ok: false, error: e.message || '服务器内部错误' })
    }
  })
  return server
}

function parsePort(argv) {
  const i = argv.indexOf('--port')
  if (i >= 0 && argv[i + 1]) {
    const p = Number(argv[i + 1])
    if (!Number.isInteger(p) || p < 1 || p > 65535) { console.error('--port 须为 1–65535 的整数'); process.exit(2) }
    return p
  }
  const env = Number(process.env.PORT)
  if (process.env.PORT && (!Number.isInteger(env) || env < 1 || env > 65535)) { console.error('PORT 环境变量须为 1–65535 的整数'); process.exit(2) }
  return env || DEFAULT_PORT
}

// 直接运行才起服务；测试 import 时只导出 createServer，不自动监听。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = parsePort(process.argv.slice(2))
  const server = createServer()
  server.listen(port, '127.0.0.1', () => {
    console.log(`自动化插件界面版 v${UI_VERSION} 已启动：http://127.0.0.1:${port}/`)
    console.log('只在本机监听，不对外开放；按 Ctrl+C 停止。')
  })
}
