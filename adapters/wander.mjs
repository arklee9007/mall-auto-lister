// 适配器 B：WANDER 本店。目标能力：固定三维（颜色/尺码/图案），三轴皆不可为空；运费三模式。
// 维度不足时用默认值填充并在报告中点名（目标硬性要求，非引擎猜测）。
// 运费（第二轮口径）：运费模板由买家自己在后台设好，工具往里填，不编固定模板。
import { freightCheck } from '../lib/platform-translate.mjs'
export const TARGET = 'wander'
export const CAPABILITIES = { maxSpecDims: 3, minSpecDims: 3, specNamesFixed: ['颜色', '尺码', '图案'], extensionBag: false, specImages: false, freightModes: ['free', 'template', 'fixed'] }
const FILLERS = ['默认色', '均码', '默认款']
export function translate(product, profile) {
  const notes = []
  const axes = [[], [], []]
  const labels = ['颜色', '尺码', '图案']
  ;(product.specDims || []).forEach((d, i) => { axes[i] = d.values; if (d.name !== labels[i]) notes.push(`规格维「${d.name}」映射到本店固定轴「${labels[i]}」`) })
  axes.forEach((a, i) => { if (!a.length) { axes[i] = [FILLERS[i]]; notes.push(`本店要求三轴非空，${labels[i]} 轴以「${FILLERS[i]}」填充`) } })
  for (const [key, val] of Object.entries(product.extensions || {})) notes.push(`扩展字段 ${key}=${val}：目标无对应字段，已记录未写入`)
  const detailImages = (product.images || []).filter(i => i.role !== 'main').map(i => i.file)
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (product.freightMode === 'template' && !fr.resolved.error) notes.push(`运费：${fr.resolved.summary}`)
  return {
    payload: {
      name: product.name, categoryName: product.category,
      colors: axes[0], sizes: axes[1], patterns: axes[2],
      subtitle: product.subtitle, keywords: product.keywords, desc: product.description,
      images: [product.mainImage], detailImages,
      price: product.price, freightMode: product.freightMode, freightFixed: product.freightFixed, freightTemplateName: fr.resolved.templateName || product.freightTemplate, 运费说明: fr.resolved.summary,
      skus: product.skus.map(s => ({ color: s.spec[0] || FILLERS[0], size: s.spec[1] || FILLERS[1], pattern: s.spec[2] || FILLERS[2], stock: s.stock, price: s.price })),
    },
    notes,
  }
}
