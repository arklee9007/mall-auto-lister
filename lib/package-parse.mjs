// 素材包解析：按映射配置把对方清单行 + 图片文件转成中间格式。只解析、不写库（试跑与正式导入共用此解析）。
import { blankProduct, validateProduct, expandSkus } from './intermediate.mjs'
import { resolveFreight } from './freight.mjs'
function toCents(v, unit) {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? (unit === 'fen' ? v : v * 100) : Math.round(v * 100)
  const s = String(v ?? '').trim().replace(/[¥￥,]/g, '')
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  // 单位由配置 priceUnit 定死（核对映射时人确认），程序不再靠数值猜元/分（G-05）
  return unit === 'fen' ? Math.round(n) : Math.round(n * 100)
}
function toInt(v) {
  const n = Number(String(v ?? '').trim())
  return Number.isSafeInteger(n) ? n : null
}
function splitValues(v, sep) { return String(v ?? '').split(sep).map(s => s.trim()).filter(Boolean) }
export function roleOfFile(file, imageRules) {
  const lower = file.toLowerCase()
  for (const role of ['main', 'spec', 'info', 'detail']) {
    if ((imageRules[role] || []).some(mark => lower.includes(String(mark).toLowerCase()))) return role
  }
  return 'detail'
}
function freightFromCell(v) {
  const s = String(v ?? '').trim()
  if (['包邮', '免邮', 'free', '0'].includes(s.toLowerCase())) return { freightMode: 'free', freightFixed: 0 }
  const fixed = toCents(s, 'yuan')
  if (fixed !== null) return { freightMode: 'fixed', freightFixed: fixed }
  // 无法识别的运费值不再无声兜底成模板名：仍按模板名走以便人工核对，但必须出警告（G-04）
  return { freightMode: 'template', freightTemplate: s, warning: `运费值「${s}」无法识别，已按运费模板名处理，请核对` }
}
// rows: 对象数组（键为来源列名）；files: 素材包内图片文件名数组；rowImages: 每行关联的图片文件（可选，按行号或商品名前缀匹配）
export function parsePackage(rows, files, profile) {
  const mapping = profile.mapping
  const col = (field) => mapping.columns?.[field]?.source
  const products = [], errors = [], warnings = [], freight = []
  const priceUnit = profile.priceUnit || 'yuan'
  if (!profile.priceUnit) warnings.push('价格单位未在配置中声明，默认按“元”解析；请在核对映射时确认 priceUnit（yuan 元 / fen 分）')
  if ((mapping.specDims || []).length > 3) errors.push(`规格维度映射 ${(mapping.specDims || []).length} 个超过 3 维上限：请拆包或走定制适配`)
  const specSources = (mapping.specDims || []).map(d => ({ name: d.name, source: d.source }))
  rows.forEach((row, idx) => {
    const lineNo = idx + 2 // 含表头行
    const p = blankProduct()
    p.name = String(row[col('name')] ?? '').trim()
    p.category = String(row[col('category')] ?? '').trim()
    const price = toCents(row[col('price')], priceUnit)
    if (price === null) errors.push(`第 ${lineNo} 行：价格无法解析`)
    else p.price = price
    const stock = toInt(row[col('stock')])
    if (stock === null) errors.push(`第 ${lineNo} 行：库存须为整数`)
    else p.stock = stock
    p.mainImage = String(row[col('mainImage')] ?? '').trim()
    // 运费（第二轮口径）：运费模板由买家自己在后台设好，工具往里填。
    // 运费格为空即报错（不静默编默认模板）；模板名须在登记表里对得上号，对不上只警告、不阻断。
    const freightCell = String(row[col('freightMode')] ?? '').trim()
    if (!freightCell) {
      errors.push(`第 ${lineNo} 行（${p.name || '未命名'}）：运费方式未填，请填包邮 / 固定运费金额 / 买家后台已建好的运费模板名（工具不自动编默认值）`)
      p.freightMode = 'template'; p.freightFixed = 0; p.freightTemplate = ''
      freight.push({ name: p.name, mode: 'template', summary: '运费模板未定（运费格为空）', templateName: '' })
    } else {
      const fr = freightFromCell(row[col('freightMode')])
      if (fr.warning) warnings.push(`第 ${lineNo} 行（${p.name || '未命名'}）：${fr.warning}`)
      p.freightMode = fr.freightMode; p.freightFixed = fr.freightFixed || 0; p.freightTemplate = fr.freightTemplate || ''
      const resolved = resolveFreight(p, profile)
      if (resolved.error) errors.push(`第 ${lineNo} 行：${resolved.error}`)
      if (resolved.warning) warnings.push(`第 ${lineNo} 行（${p.name || '未命名'}）：${resolved.warning}`)
      freight.push({ name: p.name, mode: resolved.mode, summary: resolved.summary, templateName: resolved.templateName })
    }
    if (col('description')) p.description = String(row[col('description')] ?? '').trim()
    if (col('subtitle')) p.subtitle = String(row[col('subtitle')] ?? '').trim()
    if (col('keywords')) p.keywords = splitValues(row[col('keywords')], /[,，;；]/)
    for (const [key, m] of Object.entries(mapping.extensions || {})) {
      if (m.source && row[m.source] !== undefined && String(row[m.source]).trim() !== '') p.extensions[key] = String(row[m.source]).trim()
    }
    // 规格维：每维一列（格内多值用分隔符拆）；或单列组合值（用 specSeparator 拆维，维名取映射维名）
    const sep = profile.specSeparator || '/'
    const dimValues = specSources.map(d => splitValues(row[d.source], profile.specValueSeparator || ','))
    if (specSources.length === 1 && dimValues[0].length >= 2 && dimValues[0].every(v => v.includes(sep))) {
      // 组合列模式：如 "红/L,蓝/M"（多段且每段都含分隔符）→ 拆成多维
      const parts = dimValues[0].map(v => v.split(sep).map(s => s.trim()))
      const dimCount = parts[0].length
      if (dimCount > 1 && dimCount <= 3 && parts.every(x => x.length === dimCount)) {
        p.specDims = Array.from({ length: dimCount }, (_, i) => ({ name: (mapping.specDims[i]?.name) || `规格${i + 1}`, values: [...new Set(parts.map(x => x[i]))] }))
      } else {
        p.specDims = [{ name: specSources[0].name, values: dimValues[0] }]
      }
    } else {
      // 单维多值：值分隔符与维分隔符都可拆值（如 "正红/豆沙" 为同一维的两个值）
      p.specDims = specSources.map((d, i) => ({ name: d.name, values: dimValues[i].flatMap(v => v.split(sep).map(s => s.trim())).filter(Boolean) })).filter(d => d.values.length)
    }
    // 图片：主图取映射列；其余按文件名规则归角色（文件名含商品名或行号前缀的归属本行）
    // 主图去重（G-10）：主图列值与图片目录文件同名（比 basename）时只保留一条
    const baseName = (f) => String(f).split('/').pop()
    const owned = files.filter(f => f.includes(p.name) || f.startsWith(`row${lineNo}_`) || f.startsWith(`${idx + 1}_`))
    const seen = new Set()
    for (const f of owned) {
      if (seen.has(f)) continue
      if (p.mainImage && baseName(f) === baseName(p.mainImage)) { seen.add(f); continue }
      seen.add(f)
      const role = roleOfFile(f, profile.imageRules || {})
      p.images.push({ role, file: f })
      if (role === 'main' && !p.mainImage) p.mainImage = f
    }
    if (p.mainImage && !p.images.some(i => i.file === p.mainImage)) p.images.unshift({ role: 'main', file: p.mainImage })
    // 同文件多角色只保留首次出现的角色
    p.images = p.images.filter((img, i, arr) => arr.findIndex(x => x.file === img.file) === i)
    expandSkus(p)
    const v = validateProduct(p)
    for (const e of v.errors) errors.push(`第 ${lineNo} 行（${p.name || '未命名'}）：${e}`)
    for (const w of v.warnings) warnings.push(`第 ${lineNo} 行（${p.name || '未命名'}）：${w}`)
    products.push(p)
  })
  // 未映射列提醒（G-01）：按实际行键名与映射用掉的来源列逐项比对，值未导入的列在报告里点名
  if (rows.length) {
    const usedSources = new Set([
      ...Object.values(mapping.columns || {}).map(c => c.source).filter(Boolean),
      ...specSources.map(d => d.source),
      ...Object.values(mapping.extensions || {}).map(m => m.source).filter(Boolean),
    ])
    const actualUnmapped = Object.keys(rows[0]).filter(k => !usedSources.has(k))
    if (actualUnmapped.length) warnings.push(`未映射列（值未导入）：${actualUnmapped.join('、')}。如需导入，请补映射后重新核对`)
  }
  return { products, errors, warnings, valid: errors.length === 0, freight }
}
