// 三平台与自建店适配器共用的翻译检查：运费映射、主图张数、规格维与 SKU 上限。
// 只做纯检查与提醒，不碰网络与数据库；上限数字来自各家公开资料（见 lib/platform-fields.mjs 与 lib/storefront-fields.mjs）。
import { resolveFreight } from './freight.mjs'
// 运费：返回 { resolved, note }；缺模板名时 note 为“运费未定”提醒，调用方须同时进 missingRequired。
export function freightCheck(product, profile = {}) {
  const resolved = resolveFreight(product, profile)
  if (resolved.error) return { resolved, note: `运费未定：${resolved.error}` }
  if (resolved.warning) return { resolved, note: resolved.warning }
  return { resolved, note: '' }
}
export function imageCheckNotes(product, rules, label) {
  const notes = []
  if (!rules) return notes
  const mains = new Set([product.mainImage, ...(product.images || []).filter(i => i.role === 'main').map(i => i.file)].filter(Boolean))
  if (rules.mainMin && mains.size < rules.mainMin) notes.push(`主图 ${mains.size} 张，少于${label}最少要求 ${rules.mainMin} 张，请补图后再提交`)
  if (rules.mainMax && mains.size > rules.mainMax) notes.push(`主图 ${mains.size} 张，超过${label}上限 ${rules.mainMax} 张，多余的会被平台截掉`)
  return notes
}
export function skuCheckNotes(product, fieldMap, label) {
  const notes = []
  if (!fieldMap) return notes
  if (fieldMap.skuMax && (product.skus || []).length > fieldMap.skuMax) notes.push(`SKU ${(product.skus || []).length} 个，超过${label}上限 ${fieldMap.skuMax} 个，请拆商品`)
  if (fieldMap.specMaxDims && (product.specDims || []).length > fieldMap.specMaxDims) notes.push(`规格 ${(product.specDims || []).length} 维，超过${label}上限 ${fieldMap.specMaxDims} 维`)
  if (fieldMap.specMaxDims === null) notes.push(`${label}规格维上限未查到公开资料（待后台实测），本插件引擎上限 3 维`)
  return notes
}
