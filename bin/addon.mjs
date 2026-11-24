#!/usr/bin/env node
// 通用自动化插件 CLI（中途版本）：模板扫描 / 映射核对 / 试跑 / 模拟导入 / 文件包 / 上下架计划。
// 本版本不连接任何真实数据库：导入只写入内存假目标（打印草稿）或文件包。真实写库待 Sam 中途测试反馈后做终版。
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../lib/csv.mjs'
import { readTemplate, proposeMapping, formatOfFile } from '../lib/template-scan.mjs'
import { DEFAULT_CONFIG, TARGETS, assertTarget, loadProfile, saveProfile, validateProfile } from '../lib/mapping-store.mjs'
import { parsePackage } from '../lib/package-parse.mjs'
import { discover, discoverCsv } from '../lib/field-discovery.mjs'
import { platformFieldMap } from '../lib/platform-fields.mjs'
import { storefrontFieldMap } from '../lib/storefront-fields.mjs'
import { buildTemplateDraft, templateToProfile, loadTemplate, loadTemplateOrProfile, saveTemplate, parseTemplateInput } from '../lib/template-generator.mjs'
import { summarizeReminders, formatReminderSummary } from '../lib/report.mjs'
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
import { createFakeTarget } from '../lib/target-fake.mjs'
import { planSchedule, applySchedule, rollbackSchedule, formatInTz, toUtcMs, normalizeRules } from '../lib/schedule.mjs'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILES = join(ROOT, 'profiles')
const ADAPTERS = { 'generic-template': adapterA, wander: adapterB, 'file-only': adapterC, douyin: adapterD, taobao: adapterE, xiaohongshu: adapterF, shopify: adapterG, woocommerce: adapterH, youzan: adapterI, shopline: adapterJ }
function readRows(path) {
  const text = readFileSync(path, 'utf-8')
  if (path.endsWith('.json')) {
    const data = JSON.parse(text)
    const rows = Array.isArray(data) ? data : data.rows
    return rows
  }
  const parsed = parseCsv(text)
  const headers = parsed[0]
  return parsed.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])))
}
function listImages(dir) {
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir, { recursive: true }).filter(f => /\.(png|jpe?g|webp|svg|gif)$/i.test(f)).map(String)
}
function loadAndCheck(name) {
  const profile = loadProfile(PROFILES, name)
  const errs = validateProfile(profile)
  if (errs.length) { console.error('配置校验失败：'); errs.forEach(e => console.error(' - ' + e)); process.exit(2) }
  return profile
}
// 导入时指定专用模板：--template <模板.json|映射配置.json> 用模板文件现场生成配置，不改 profiles/ 下的存量配置。
function loadProfileOrTemplate(name) {
  const templatePath = flag('--template')
  if (!templatePath) return loadAndCheck(name)
  let loaded
  try { loaded = loadTemplateOrProfile(templatePath) } catch (e) { console.error('模板加载失败：' + e.message); process.exit(2) }
  const profile = loaded.kind === 'template' ? templateToProfile(loaded.draft, name) : { ...loaded.profile, profileName: name }
  const errs = validateProfile(profile)
  if (errs.length) { console.error('模板转配置校验失败：'); errs.forEach(e => console.error(' - ' + e)); process.exit(2) }
  return profile
}
const [cmd, ...args] = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
if (cmd === 'scan') {
  let format
  try { format = formatOfFile(args[0]) } catch (e) { console.error('扫描拒绝：' + e.message); process.exit(2) }
  const text = readFileSync(args[0], 'utf-8')
  const { headers } = readTemplate(text, format)
  const proposal = proposeMapping(headers)
  if (proposal.specDimsOverflow) console.error(`注意：规格维 ${proposal.specDims.length} 个超过 3 维上限，请拆包或走定制适配`)
  console.log(JSON.stringify({ headers, proposal }, null, 2))
} else if (cmd === 'discover') {
  // 字段发现：discover <字段文件.json> [--kind db|api] 或 discover <样表.csv|json> [--kind csv]
  const kind = flag('--kind') || (args[0].endsWith('.csv') || args[0].endsWith('.json') ? 'csv' : 'db')
  try {
    let result
    if (kind === 'csv') {
      const format = formatOfFile(args[0])
      result = discoverCsv(readFileSync(args[0], 'utf-8'), format)
    } else {
      result = discover(JSON.parse(readFileSync(args[0], 'utf-8')), kind)
    }
    console.log(JSON.stringify(result, null, 2))
    if (result.targetRequiredUnmapped?.length) console.error('目标必填未映射：' + result.targetRequiredUnmapped.join('、'))
    if (result.suspectedSpecDims?.length) console.error('疑似规格维（请人工勾选确认）：' + result.suspectedSpecDims.map(d => d.name).join('、'))
  } catch (e) { console.error('字段发现失败：' + e.message); process.exit(2) }
} else if (cmd === 'platform-fields') {
  // 平台字段映射表：platform-fields <douyin|taobao|xiaohongshu>
  try { console.log(JSON.stringify(platformFieldMap(args[0]), null, 2)) } catch (e) { console.error(e.message); process.exit(2) }
} else if (cmd === 'storefront-fields') {
  // 自建店字段映射表：storefront-fields <shopify|woocommerce|youzan|shopline>
  try { console.log(JSON.stringify(storefrontFieldMap(args[0]), null, 2)) } catch (e) { console.error(e.message); process.exit(2) }
} else if (cmd === 'generate-template') {
  // 用户自生成模板：generate-template <样表.csv|字段清单.json|字段清单.txt> --out <模板.json> [--fields "a,b,c"] [--name X] [--target X]
  // --fields 直接给字段名时可不给输入文件。
  const out = flag('--out')
  if (!out) { console.error('生成拒绝：须用 --out 指定模板文件保存位置（例：--out 我的模板.json）'); process.exit(2) }
  const target = flag('--target') || 'generic-template'
  try { assertTarget(target) } catch (e) { console.error('生成拒绝：' + e.message); process.exit(2) }
  const name = flag('--name') || '我的专用模板'
  try {
    let input
    const fieldsFlag = flag('--fields')
    if (fieldsFlag) {
      input = { fields: fieldsFlag.split(/[,，]/).map(s => s.trim()).filter(Boolean), rows: [], headers: fieldsFlag.split(/[,，]/).map(s => s.trim()).filter(Boolean), sourceKind: 'fields' }
    } else {
      if (!args[0]) { console.error('生成拒绝：须给一个输入文件（样表 .csv / 字段清单 .json/.txt），或用 --fields 直接给字段名'); process.exit(2) }
      input = parseTemplateInput(readFileSync(args[0], 'utf-8'), args[0])
    }
    const draft = buildTemplateDraft({ ...input, sourceLabel: args[0] || '直接给的字段名', name, target })
    saveTemplate(out, draft)
    console.log('模板草稿已生成：' + out)
    console.log(`目标：${target}；字段 ${draft.fields.length} 个（必填 6 项已映射 ${draft.fields.filter(f => f.required && f.sourceColumn).length}/6）；分类 ${draft.categories.length ? draft.categories.join('、') : '（无，请自己填）'}；规格维 ${draft.specDims.length} 个；未认出列：${draft.unmappedFields.join('、') || '无'}`)
    console.log('下一步：用记事本打开模板文件，按文件顶部的 howToEdit 改字段名、分类、规格维与运费模板，保存后跑：')
    console.log(`  node bin/addon.mjs init-profile <配置名> --from-template ${out} --target ${target}`)
  } catch (e) { console.error('生成模板失败：' + e.message); process.exit(2) }
} else if (cmd === 'init-profile') {
  const [name, template] = args
  const target = flag('--target') || 'generic-template'
  try { assertTarget(target) } catch (e) { console.error('生成拒绝：' + e.message); process.exit(2) }
  const fromTemplate = flag('--from-template')
  if (fromTemplate) {
    // 从用户自生成的专用模板建配置：不再扫样表，直接用模板里的映射、分类、规格维与运费模板登记。
    // 传映射配置.json（profile 格式）也行：直接按原样存为配置。
    let loaded
    try { loaded = loadTemplateOrProfile(fromTemplate) } catch (e) { console.error('生成拒绝：' + e.message); process.exit(2) }
    const profile = loaded.kind === 'template' ? templateToProfile(loaded.draft, name) : { ...loaded.profile, profileName: name }
    // 目标：显式给了 --target 就按它来；没给就按模板/配置自带的目标，不冲掉
    if (flag('--target')) profile.target = flag('--target')
    const errs = validateProfile(profile)
    if (errs.length) { console.error('生成拒绝：模板转配置校验失败：'); errs.forEach(e => console.error(' - ' + e)); process.exit(2) }
    const p = saveProfile(PROFILES, name, profile)
    console.log('配置已生成（来自专用模板 ' + fromTemplate + '）：' + p)
    console.log('缺失必填映射：' + (profile.mapping.missingRequired.join(', ') || '无'))
    console.log('未映射列：' + (profile.mapping.unmapped.join(', ') || '无'))
    console.log('运费模板登记：' + ((profile.freightTemplates || []).map(t => t.name).join('、') || '无（模板方式导入时会报错提示先设模板）'))
    if (profile.mapping.specDimsOverflow) console.log(`注意：规格维 ${profile.mapping.specDims.length} 个超过 3 维上限，配置校验会拒绝使用，请先拆包`)
    process.exit(0)
  }
  let templateFormat
  try { templateFormat = formatOfFile(template) } catch (e) { console.error('生成拒绝：' + e.message); process.exit(2) }
  const text = readFileSync(template, 'utf-8')
  const { headers } = readTemplate(text, templateFormat)
  const proposal = proposeMapping(headers)
  const profile = { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), profileName: name, target, mapping: proposal }
  const p = saveProfile(PROFILES, name, profile)
  console.log('配置已生成（须人工核对后保存复用）：' + p)
  console.log('缺失必填映射：' + (proposal.missingRequired.join(', ') || '无'))
  console.log('未映射列：' + (proposal.unmapped.join(', ') || '无'))
  if (proposal.specDimsOverflow) console.log(`注意：规格维 ${proposal.specDims.length} 个超过 3 维上限，配置校验会拒绝使用，请先拆包`)
} else if (cmd === 'dry-run' || cmd === 'import-fake') {
  const profile = loadProfileOrTemplate(args[0])
  if (cmd === 'import-fake' && ADAPTERS[profile.target]?.CAPABILITIES?.implemented === false) {
    console.error(`模拟导入拒绝：${profile.target} 平台/店铺接口未接通（只做了字段映射与接口定义），先用 dry-run 看映射，写入口待接通接口后实现`)
    process.exit(2)
  }
  const rows = readRows(args[1])
  const files = listImages(flag('--images'))
  const { products, errors, warnings, valid, freight } = parsePackage(rows, files, profile)
  const adapter = ADAPTERS[profile.target]
  const translated = valid ? products.map(p => adapter.translate(p, profile)) : []
  const adapterNotes = []
  translated.forEach((t, i) => {
    (t.notes || []).forEach(n => adapterNotes.push(`[适配提醒 ${products[i].name}] ${n}`))
    // 平台必填缺失（品牌、运费模板等）须在报告里点名，不静默
    ;(t.missingRequired || []).forEach(m => adapterNotes.push(`[必填缺失 ${products[i].name}] ${m}：请补齐后再提交，缺失不得上架`))
  })
  const summary = summarizeReminders(warnings, adapterNotes)
  console.log(`解析：${products.length} 件商品，错误 ${errors.length} 条，${formatReminderSummary(summary)}`)
  errors.forEach(e => console.log('  [错误] ' + e))
  warnings.forEach(w => console.log('  [提醒] ' + w))
  if (!valid) { console.log('试跑结论：有错误，拒绝导入（零写入）'); process.exit(1) }
  adapterNotes.forEach(n => console.log('  ' + n))
  console.log('运费映射：')
  ;(freight || []).forEach(f => console.log(`  ${f.name}：${f.summary}`))
  if (cmd === 'dry-run') {
    console.log('试跑结论：只解析、只出报告，未写入任何目标（零写入）。首件翻译结果：')
    console.log(JSON.stringify(translated[0]?.payload ?? null, null, 2))
  } else {
    const target = createFakeTarget(adapter.CAPABILITIES)
    const before = target.count()
    const drafts = translated.map(t => target.insertDraft(t.payload))
    console.log(`模拟导入：假目标草稿 ${before} → ${target.count()} 件（内存模拟，未碰真实数据库）。草稿清单：`)
    drafts.forEach(d => console.log(`  ${d._id} ${d.name} stage=${d.stage} review=${d.reviewStatus} onShelf=${d.onShelf}`))
  }
} else if (cmd === 'file-pack') {
  const profile = loadProfileOrTemplate(args[0])
  const rows = readRows(args[1])
  const files = listImages(flag('--images'))
  const { products, errors, valid } = parsePackage(rows, files, profile)
  if (!valid) { errors.forEach(e => console.log('  [错误] ' + e)); console.log('文件包生成拒绝：有解析错误'); process.exit(1) }
  const out = flag('--out') || join(ROOT, 'out')
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, '标准商品表.csv'), adapterC.renderSheet(products, profile), 'utf-8')
  writeFileSync(join(out, '图片改名计划.json'), JSON.stringify(adapterC.renameImages(products), null, 2), 'utf-8')
  console.log(`文件包已生成：${out}（标准商品表.csv + 图片改名计划.json），共 ${products.length} 件`)
} else if (cmd === 'schedule-plan') {
  const profile = loadAndCheck(args[0])
  const products = JSON.parse(readFileSync(args[1], 'utf-8'))
  const rules = JSON.parse(readFileSync(args[2], 'utf-8'))
  const nowMs = flag('--now') ? toUtcMs(flag('--now'), profile.timezone) : Date.now()
  let normalized
  try { normalized = normalizeRules(rules, profile.timezone) } catch (e) { console.error('规则时间错误：' + e.message); process.exit(2) }
  const plan = planSchedule(products, normalized, profile.schedule, nowMs)
  console.log(`计划时间（${profile.timezone}）：${formatInTz(nowMs, profile.timezone)}`)
  console.log(`动作 ${plan.actions.length} 个，跳过 ${plan.skipped.length} 个，报警 ${plan.alarms.length} 条`)
  plan.actions.forEach(a => console.log(`  [动作] ${a.action} ${a.name}（${a.id}）`))
  plan.skipped.forEach(s => console.log(`  [跳过] ${s.id}：${s.reason}`))
  plan.alarms.forEach(a => console.log(`  [报警] ${a}`))
} else if (cmd === 'schedule-demo') {
  const profile = loadAndCheck(args[0])
  const products = JSON.parse(readFileSync(args[1], 'utf-8'))
  const rules = JSON.parse(readFileSync(args[2], 'utf-8'))
  const nowMs = flag('--now') ? toUtcMs(flag('--now'), profile.timezone) : Date.now()
  let normalized
  try { normalized = normalizeRules(rules, profile.timezone) } catch (e) { console.error('规则时间错误：' + e.message); process.exit(2) }
  const plan = planSchedule(products, normalized, profile.schedule, nowMs)
  const before = products.map(p => `${p.id}:${p.onShelf}`).join(' ')
  const journal = applySchedule(products, plan)
  const after = products.map(p => `${p.id}:${p.onShelf}`).join(' ')
  const restored = rollbackSchedule(products, journal)
  const rolled = products.map(p => `${p.id}:${p.onShelf}`).join(' ')
  console.log('执行前：' + before)
  console.log('执行后：' + after)
  console.log(`回滚 ${restored} 条后：` + rolled)
  console.log('回滚一致：' + (before === rolled ? '是' : '否'))
} else {
  console.log('用法：scan <模板> | discover <字段文件> [--kind db|api|csv] | platform-fields <douyin|taobao|xiaohongshu> | storefront-fields <shopify|woocommerce|youzan|shopline> | generate-template <样表|字段清单> --out <模板.json> [--fields "a,b,c"] [--name X] [--target X] | init-profile <名> <模板> [--target X] | init-profile <名> --from-template <模板.json> [--target X] | dry-run <配置名> <清单> [--images 目录] [--template 模板.json] | import-fake <配置名> <清单> [--images 目录] [--template 模板.json] | file-pack <配置名> <清单> [--images 目录] [--out 目录] [--template 模板.json] | schedule-plan <配置名> <状态json> <规则json> [--now YYYY-MM-DDTHH:mm] | schedule-demo <配置名> <状态json> <规则json> [--now ...]')
  process.exit(1)
}
