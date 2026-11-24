// 字段发现：三种输入 → 自动提议映射 → 人核对一次保存复用。
// 输入：① 样表表头（CSV/JSON 文本）；② 数据库字段列表 JSON
//   {table, fields: [{name, type, required, comment}]}；
// ③ API schema JSON：{properties: {字段名: {...}}} 或 {fields: [{name, ...}]}。
// 输出与 proposeMapping 同形，另附 suspectedSpecDims（疑似规格维）与
// targetRequiredUnmapped（目标必填但未映射的字段，须报警）。
import { proposeMapping, readTemplate, SYNONYMS, EXTENSION_SYNONYMS } from './template-scan.mjs'
function norm(h) { return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '') }
export function normalizeFields(input, kind) {
  if (kind === 'db') {
    const fields = input.fields || []
    if (!Array.isArray(fields) || !fields.length) throw new Error('数据库字段列表须为含 fields 数组的 JSON')
    return fields.map(f => ({ name: String(f.name), label: f.comment || f.label || '', required: !!f.required, type: f.type || '' }))
  }
  if (kind === 'api') {
    if (input.properties && typeof input.properties === 'object') {
      return Object.entries(input.properties).map(([name, def]) => ({ name, label: def?.title || def?.description || '', required: false, type: def?.type || '' }))
    }
    if (Array.isArray(input.fields)) {
      return input.fields.map(f => ({ name: String(f.name), label: f.comment || f.label || '', required: !!f.required, type: f.type || '' }))
    }
    throw new Error('API schema 须含 properties 对象或 fields 数组')
  }
  throw new Error('kind 须为 db 或 api（样表表头请走 discoverCsv）')
}
function matchByLabel(fields, proposal) {
  // 字段名没命中同义词时，再拿标签/注释碰一碰；命中只给 review，不给 auto
  const used = new Set(Object.values(proposal.columns).filter(c => c.source).map(c => c.source))
  const tryDict = (dict) => {
    for (const [field, syns] of Object.entries(dict)) {
      if (proposal.columns[field]?.source) continue
      for (const f of fields) {
        if (used.has(f.name)) continue
        const hay = norm(f.label)
        if (hay && syns.some(s => hay.includes(norm(s)) || norm(s).includes(hay))) {
          proposal.columns[field] = { source: f.name, status: 'review', matchedBy: 'label' }
          used.add(f.name)
          break
        }
      }
    }
  }
  tryDict(SYNONYMS)
  return proposal
}
export function discover(input, kind) {
  const fields = normalizeFields(input, kind)
  const proposal = matchByLabel(fields, proposeMapping(fields.map(f => f.name)))
  const usedSources = new Set([
    ...Object.values(proposal.columns).filter(c => c.source).map(c => c.source),
    ...proposal.specDims.map(d => d.source),
    ...Object.values(proposal.extensions).filter(e => e.source).map(e => e.source),
  ])
  const targetRequiredUnmapped = fields.filter(f => f.required && !usedSources.has(f.name)).map(f => f.name)
  return { kind, table: input.table || null, fields: fields.map(f => f.name), proposal, targetRequiredUnmapped }
}
export function discoverCsv(text, format) {
  const { headers, rows } = readTemplate(text, format)
  const proposal = proposeMapping(headers)
  // 疑似规格维（G-02）：未命中规格关键字的列，若值呈枚举状（去重后 2–20 个短值）也列为候选，由人勾选
  const used = new Set([
    ...Object.values(proposal.columns).filter(c => c.source).map(c => c.source),
    ...proposal.specDims.map(d => d.source),
    ...Object.values(proposal.extensions).filter(e => e.source).map(e => e.source),
  ])
  const suspectedSpecDims = []
  headers.forEach((h, i) => {
    if (used.has(h)) return
    const values = [...new Set(rows.map(r => String(r[i] ?? '').trim()).filter(Boolean))]
    if (values.length >= 2 && values.length <= 20 && values.every(v => v.length <= 12)) {
      suspectedSpecDims.push({ name: h, source: h, values, status: 'review' })
    }
  })
  return { kind: 'csv', fields: headers, proposal, suspectedSpecDims, targetRequiredUnmapped: [] }
}
