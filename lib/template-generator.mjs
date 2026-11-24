// 用户自生成模板（第二轮，generate-template 流程）：
// 买家给一张样表或一份字段清单 → 程序生成模板文件草稿（JSON，人能直接看懂、直接改）
// → 买家自己改字段名、分类、规格维 → 保存为自己的专用模板 → 导入时指定该模板。
// 模板文件格式：JSON（选 JSON 不选 CSV：字段、分类、规格维、运费模板要放进同一份文件，
// CSV 一张表装不下；JSON 用记事本就能改，改完 init-profile --from-template 即用）。
// 生成逻辑复用现成的 proposeMapping（同义词典三档置信度），不另起一套猜法。
import { readFileSync, writeFileSync } from 'node:fs'
import { proposeMapping, readTemplate } from './template-scan.mjs'
import { discoverCsv } from './field-discovery.mjs'
import { DEFAULT_IMAGE_RULES, DEFAULT_CONFIG } from './mapping-store.mjs'
import { blankFreightTemplate, validateFreightTemplates } from './freight.mjs'
import { parseCsv } from './csv.mjs'
export const TEMPLATE_FORMAT = 1
const FIELD_LABELS = {
  name: '商品名', category: '分类', price: '价格', stock: '库存', mainImage: '主图',
  freightMode: '运费方式', description: '描述', subtitle: '副标题', keywords: '关键词',
  expiry: '保质期', netContent: '净含量', ingredients: '配料', efficacy: '功效', model: '型号', weight: '重量', brand: '品牌',
}
const REQUIRED_TARGET_FIELDS = ['name', 'category', 'price', 'stock', 'mainImage', 'freightMode']
// 从样表行里抽分类清单与规格维取值（只取去重后的短值，最多 20 个；多了不猜、留空给人填）。
export function extractCategories(rows, headers, mapping) {
  const src = mapping.columns?.category?.source
  if (!src || !rows?.length) return []
  const idx = headers.indexOf(src)
  if (idx < 0) return []
  return [...new Set(rows.map(r => String(r[idx] ?? '').trim()).filter(Boolean))].slice(0, 20)
}
export function extractSpecValues(rows, headers, mapping) {
  const out = []
  for (const d of mapping.specDims || []) {
    const idx = headers.indexOf(d.source)
    if (idx < 0) { out.push({ name: d.name, values: [] }); continue }
    const values = [...new Set(rows.flatMap(r => String(r[idx] ?? '').split(/[,，/]/).map(s => s.trim()).filter(Boolean)))].slice(0, 20)
    out.push({ name: d.name, values })
  }
  return out
}
export function buildTemplateDraft({ fields, rows = [], headers = fields, sourceKind = 'fields', sourceLabel = '', name = '我的专用模板', target = 'generic-template' }) {
  if (!Array.isArray(fields) || !fields.length) throw new Error('生成模板至少须给一个字段（样表表头或字段清单）')
  const proposal = proposeMapping(fields)
  const fieldList = []
  for (const f of ['name', 'category', 'price', 'stock', 'mainImage', 'freightMode', 'description', 'subtitle', 'keywords']) {
    const c = proposal.columns[f]
    fieldList.push({ targetField: f, label: FIELD_LABELS[f], sourceColumn: c.source || '', required: REQUIRED_TARGET_FIELDS.includes(f), confidence: c.status, note: c.status === 'missing' ? '样表里没有这一列：请填你表里的列名，没有就留空并在导入前补齐' : '' })
  }
  for (const [key, m] of Object.entries(proposal.extensions || {})) {
    fieldList.push({ targetField: key, label: FIELD_LABELS[key], sourceColumn: m.source || '', required: false, confidence: m.status, note: '扩展字段：目标有字段就写，没有写进报告提醒' })
  }
  const categories = extractCategories(rows, headers, proposal)
  const specDims = extractSpecValues(rows, headers, proposal)
  const unmappedFields = [...proposal.unmapped]
  return {
    templateFormat: TEMPLATE_FORMAT,
    templateName: name,
    target,
    createdFrom: sourceKind === 'sample' ? `样表：${sourceLabel}` : `字段清单：${sourceLabel || '直接给的字段名'}`,
    createdAt: new Date().toISOString().slice(0, 10),
    howToEdit: [
      '用记事本 / VS Code 打开本文件直接改：fields 里每行的 sourceColumn 改成你表里的列名；categories 改成你的分类；specDims 改维名与取值；freightTemplates 改成你后台已建好的运费模板。',
      '必填 6 项（商品名、分类、价格、库存、主图、运费方式）的 sourceColumn 不能为空，空着导入会被拒绝。',
      '改完保存，然后跑：node bin/addon.mjs init-profile <配置名> --from-template <本文件> --target <目标>，再 dry-run 试跑。',
    ],
    fields: fieldList,
    unmappedFields,
    categories,
    specDims,
    specValueSeparator: ',',
    priceUnit: 'yuan',
    freightTemplates: [blankFreightTemplate()],
    freightTemplateDefault: '',
    notes: unmappedFields.length ? [`未认出的列：${unmappedFields.join('、')}。如需导入，请在 fields 里加一行（targetField 写你想让它进的字段，sourceColumn 写列名），或确认丢弃。`] : [],
  }
}
// 模板草稿 → 插件能直接用的 profile（映射配置）格式。
export function templateToProfile(draft, profileName) {
  const columns = {}
  const extensions = {}
  for (const f of draft.fields || []) {
    const entry = { source: f.sourceColumn || null, status: f.sourceColumn ? (f.confidence === 'auto' ? 'auto' : 'review') : 'missing' }
    if (['expiry', 'netContent', 'ingredients', 'efficacy', 'model', 'weight', 'brand'].includes(f.targetField)) { if (entry.source) extensions[f.targetField] = entry }
    else columns[f.targetField] = entry
  }
  const specDims = (draft.specDims || []).map(d => ({ name: d.name, source: d.name, status: 'review' }))
  const missingRequired = REQUIRED_TARGET_FIELDS.filter(f => !columns[f]?.source)
  const mapping = { columns, specDims, specDimsOverflow: specDims.length > 3, extensions, unmapped: draft.unmappedFields || [], missingRequired, needsReview: missingRequired.length > 0 || specDims.length > 0 }
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    profileName: profileName || draft.templateName || 'custom-template',
    target: draft.target || 'generic-template',
    mapping,
    priceUnit: draft.priceUnit || 'yuan',
    specValueSeparator: draft.specValueSeparator || ',',
    freightTemplates: draft.freightTemplates || [],
    freightTemplateDefault: draft.freightTemplateDefault || '',
    categories: draft.categories || [],
  }
}
// 模板文件校验：必填字段无来源、来源列重复、规格超 3 维、运费模板登记有误，任一命中即报错。
export function validateTemplate(draft) {
  const errors = []
  if (!draft || typeof draft !== 'object') return ['模板文件不是有效的 JSON 对象']
  if (draft.templateFormat !== TEMPLATE_FORMAT) errors.push(`模板格式版本须为 ${TEMPLATE_FORMAT}（当前文件：${draft.templateFormat ?? '未写'}），请用 generate-template 重新生成`)
  if (!draft.target) errors.push('模板缺少 target（目标：generic-template / wander / file-only / douyin / taobao / xiaohongshu / shopify / woocommerce / youzan / shopline）')
  if (!Array.isArray(draft.fields) || !draft.fields.length) { errors.push('模板 fields 为空：至少须列出 9 个共通字段'); return errors }
  const seen = new Set()
  for (const f of draft.fields) {
    if (!f.targetField) { errors.push('模板里有一行 fields 缺少 targetField'); continue }
    if (f.sourceColumn) {
      if (seen.has(f.sourceColumn)) errors.push(`来源列重复：${f.sourceColumn} 同时映射到多个字段，请只留一个`)
      seen.add(f.sourceColumn)
    }
  }
  for (const f of REQUIRED_TARGET_FIELDS) {
    const row = draft.fields.find(x => x.targetField === f)
    if (!row?.sourceColumn) errors.push(`必填字段「${FIELD_LABELS[f]}」未指定来源列（sourceColumn 为空）：请填你表里的列名`)
  }
  if ((draft.specDims || []).length > 3) errors.push(`规格维 ${(draft.specDims || []).length} 个超过 3 维上限：请拆包或走定制适配`)
  if (!Array.isArray(draft.categories)) errors.push('模板 categories 须为数组（没有分类就写空数组 []）')
  errors.push(...validateFreightTemplates({ freightTemplates: draft.freightTemplates || [], freightTemplateDefault: draft.freightTemplateDefault || '' }))
  return errors
}
export function loadTemplate(path) {
  const draft = JSON.parse(readFileSync(path, 'utf-8'))
  const errors = validateTemplate(draft)
  if (errors.length) throw new Error('模板文件校验失败：\n - ' + errors.join('\n - '))
  return draft
}
// 模板草稿与映射配置（profile 格式）都认：映射配置.json 就是 profile 格式，
// init-profile --from-template 与 dry-run --template 传哪种都行，不用先转换。
export function loadTemplateOrProfile(path) {
  const data = JSON.parse(readFileSync(path, 'utf-8'))
  if (Array.isArray(data.fields)) {
    const errors = validateTemplate(data)
    if (errors.length) throw new Error('模板文件校验失败：\n - ' + errors.join('\n - '))
    return { kind: 'template', draft: data }
  }
  if (data.mapping && typeof data.mapping === 'object') {
    return { kind: 'profile', profile: data }
  }
  throw new Error('文件既不是模板草稿（须有 fields 数组）也不是映射配置（须有 mapping 对象）：' + path)
}
export function saveTemplate(path, draft) {
  writeFileSync(path, JSON.stringify(draft, null, 2) + '\n', 'utf-8')
  return path
}
// 输入解析：样表 CSV/JSON、字段清单 JSON {fields:[...]}、纯文本清单（一行一个字段名）。
export function parseTemplateInput(text, path) {
  const lower = String(path || '').toLowerCase()
  if (lower.endsWith('.json')) {
    const data = JSON.parse(text)
    if (Array.isArray(data)) return { fields: Object.keys(data[0] || {}), rows: data.map(r => Object.values(r)), headers: Object.keys(data[0] || {}), sourceKind: 'sample' }
    if (Array.isArray(data.fields)) return { fields: data.fields.map(String), rows: [], headers: data.fields.map(String), sourceKind: 'fields' }
    if (Array.isArray(data.rows)) return { fields: Object.keys(data.rows[0] || {}), rows: data.rows.map(r => Object.values(r)), headers: Object.keys(data.rows[0] || {}), sourceKind: 'sample' }
    throw new Error('JSON 输入须为对象数组、含 fields 数组或含 rows 数组')
  }
  if (lower.endsWith('.csv')) {
    const { headers, rows } = readTemplate(text, 'csv')
    return { fields: headers, rows, headers, sourceKind: 'sample' }
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    const fields = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => !s.startsWith('#'))
    if (!fields.length) throw new Error('字段清单为空：一行写一个字段名')
    return { fields, rows: [], headers: fields, sourceKind: 'fields' }
  }
  throw new Error('generate-template 输入只认 .csv 样表、.json（fields/rows）或 .txt/.md 字段清单，当前文件：' + path)
}
export function discoverCsvTemplate(text) { return discoverCsv(text, 'csv') }
export { parseCsv }
