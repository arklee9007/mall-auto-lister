// 模板扫描：读对方模板（CSV/JSON 表头行），按同义词典提议字段映射，人核对一次后保存复用。
// 提议只分两档：auto（高置信，可直接用）/ review（须人确认）。从不静默猜测必填字段。
import { parseCsv } from './csv.mjs'
// 模板只认 CSV 与 JSON。遇到 .xls/.xlsx 等表格文件时显式报错，不按文本解析蒙过去（F6）。
export function formatOfFile(path) {
  const lower = String(path || '').toLowerCase()
  if (/\.xlsx?$/.test(lower) || /\.xlsm$/.test(lower)) throw new Error('模板不支持 Excel（.xlsx/.xls）：请另存为 CSV 或 JSON 再扫描')
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv')) return 'csv'
  throw new Error('模板只认 .csv 或 .json 文件，当前文件：' + path)
}
export const SYNONYMS = {
  name: ['商品名', '商品名称', '品名', '产品名', '产品名称', '标题', 'name', 'title', 'product_name'],
  category: ['分类', '类目', '类别', 'category', 'cat'],
  price: ['价格', '售价', '单价', 'price', 'sale_price'],
  stock: ['库存', '库存数', 'stock', 'qty', 'quantity'],
  mainImage: ['主图', '主图链接', '主图地址', '图片', '主图片', 'main_image', 'image', 'image_url'],
  freightMode: ['运费方式', '运费', '邮费方式', 'freight', 'freight_mode', 'shipping'],
  description: ['描述', '商品描述', '详情', '详情描述', 'description', 'desc', 'detail'],
  subtitle: ['副标题', '卖点', 'subtitle'],
  keywords: ['关键词', '搜索词', 'keywords', 'tags'],
}
export const EXTENSION_SYNONYMS = {
  expiry: ['保质期', '有效期', 'expiry', 'shelf_life'],
  netContent: ['净含量', '含量', '规格含量', 'net_content', 'net_weight'],
  ingredients: ['配料', '成分', '配料表', 'ingredients'],
  efficacy: ['功效', '功能', 'efficacy'],
  model: ['型号', '款号', 'model', 'sku_code'],
  weight: ['重量', '克重', 'weight'],
  brand: ['品牌', 'brand'],
}
function norm(h) { return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '') }
export function readTemplate(text, format) {
  if (format === 'json') {
    const data = JSON.parse(text)
    const rows = Array.isArray(data) ? data : data.rows
    if (!Array.isArray(rows) || !rows.length) throw new Error('JSON 模板须为非空数组或含 rows 数组')
    const headers = Object.keys(rows[0])
    return { headers, rows: rows.map(r => headers.map(h => r[h] ?? '')) }
  }
  const rows = parseCsv(text)
  if (!rows.length) throw new Error('CSV 模板为空')
  return { headers: rows[0].map(h => String(h).trim()), rows: rows.slice(1) }
}
export function proposeMapping(headers) {
  const used = new Set()
  const columns = {}
  const normHeaders = headers.map(h => ({ raw: h, n: norm(h) }))
  const match = (synonyms) => {
    for (const syn of synonyms) {
      const hit = normHeaders.find(h => h.n === norm(syn) && !used.has(h.raw))
      if (hit) { used.add(hit.raw); return { source: hit.raw, confidence: 'high' } }
    }
    for (const syn of synonyms) {
      const hit = normHeaders.find(h => (h.n.includes(norm(syn)) || norm(syn).includes(h.n)) && h.n && !used.has(h.raw))
      if (hit) { used.add(hit.raw); return { source: hit.raw, confidence: 'low' } }
    }
    return null
  }
  for (const [field, syns] of Object.entries(SYNONYMS)) {
    const m = match(syns)
    columns[field] = m ? { source: m.source, status: m.confidence === 'high' ? 'auto' : 'review' } : { source: null, status: 'missing' }
  }
  // 规格维：剩余未用列中，含 规格/颜色/尺码/尺寸/款式/容量/口味/色号 等字样的列提议为规格维
  const specHints = ['规格', '颜色', '尺码', '尺寸', '款式', '容量', '口味', '色号', 'variant', 'option', 'spec', 'color', 'size']
  const specDims = []
  for (const h of normHeaders) {
    if (used.has(h.raw)) continue
    if (specHints.some(hint => h.n.includes(norm(hint)))) { specDims.push({ name: h.raw, source: h.raw, status: 'review' }); used.add(h.raw) }
  }
  const extensions = {}
  for (const [key, syns] of Object.entries(EXTENSION_SYNONYMS)) {
    const m = match(syns)
    if (m) extensions[key] = { source: m.source, status: m.confidence === 'high' ? 'auto' : 'review' }
  }
  const unmapped = headers.filter(h => !used.has(h))
  const missingRequired = ['name', 'category', 'price', 'stock', 'mainImage', 'freightMode'].filter(f => columns[f].status === 'missing')
  // 规格维超过 3 维时不静默截断：全数返回并立 overflow 旗，下游校验拒绝继续（G-03）
  const specDimsOverflow = specDims.length > 3
  return { columns, specDims, specDimsOverflow, extensions, unmapped, missingRequired, needsReview: missingRequired.length > 0 || specDimsOverflow || Object.values(columns).some(c => c.status === 'review') || specDims.length > 0 }
}
