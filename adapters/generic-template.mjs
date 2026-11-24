// 适配器 A：Sam 的通用模板。目标能力：0-3 维规格、维名可配、规格说明表、运费三模式。
// 目标无对应字段的内容（扩展袋、规格图）不整包失败，写入报告提醒。
// 运费（第二轮口径）：运费模板由买家自己在后台设好，工具往里填；fixed 在模板表里仍无对应值，
// 写库时按买家自设模板折算（新建同名模板或并入价格），不由工具编固定模板（G-12 落点待写库层定）。
import { freightCheck } from '../lib/platform-translate.mjs'
export const TARGET = 'generic-template'
export const CAPABILITIES = { maxSpecDims: 3, specNamesConfigurable: true, extensionBag: false, specImages: false, freightModes: ['free', 'template', 'fixed'] }
export function translate(product, profile) {
  const notes = []
  const axes = [[], [], []]
  const specLabels = []
  ;(product.specDims || []).forEach((d, i) => { axes[i] = d.values; specLabels.push(d.name) })
  for (const [key, val] of Object.entries(product.extensions || {})) notes.push(`扩展字段 ${key}=${val}：目标无对应字段，已记录未写入`)
  const specImgs = (product.images || []).filter(i => i.role === 'spec')
  if (specImgs.length) notes.push(`规格图 ${specImgs.length} 张：目标 SKU 无图片字段，已改为详情图`)
  const detailImages = (product.images || []).filter(i => i.role === 'detail' || i.role === 'spec').map(i => i.file)
  const infoImages = (product.images || []).filter(i => i.role === 'info').map(i => i.file)
  if (infoImages.length) notes.push(`说明图 ${infoImages.length} 张已并入详情图（目标规格说明为表格，非图片）`)
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (product.freightMode === 'template' && !fr.resolved.error) notes.push(`运费：${fr.resolved.summary}`)
  if (product.freightMode === 'fixed') notes.push(`固定运费 ¥${((product.freightFixed || 0) / 100).toFixed(2)}：通用模板 products.freightMode 只认 template/free 两档，无固定运费列；写库时按买家自设模板折算（新建同名模板或并入价格），不由工具编固定模板`)
  return {
    payload: {
      name: product.name, categoryName: product.category,
      colors: axes[0], sizes: axes[1], patterns: axes[2], specLabels,
      subtitle: product.subtitle, keywords: product.keywords, desc: product.description,
      images: [product.mainImage], detailImages: [...detailImages, ...infoImages],
      specChart: null, price: product.price,
      freightMode: product.freightMode, freightFixed: product.freightFixed, freightTemplateName: fr.resolved.templateName || product.freightTemplate, 运费说明: fr.resolved.summary,
      skus: product.skus.map(s => ({ color: s.spec[0] || '', size: s.spec[1] || '', pattern: s.spec[2] || '', stock: s.stock, price: s.price })),
    },
    notes,
  }
}
