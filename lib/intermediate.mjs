// 中间格式：引擎层只处理此格式，不直连任何数据库。
// 字段分三层：共通必填 / 规格（0-3 维）/ 扩展袋。
export const REQUIRED_FIELDS = ['name', 'category', 'price', 'stock', 'mainImage', 'freightMode']
export const IMAGE_ROLES = ['main', 'detail', 'spec', 'info']
// freightMode 取值：free（包邮）/ template（运费模板）/ fixed（固定运费，需 freightFixed 分）
export function blankProduct() {
  return { name: '', category: '', price: 0, stock: 0, mainImage: '', freightMode: 'free', freightFixed: 0, freightTemplate: '', description: '', subtitle: '', keywords: [], specDims: [], // [{name, values:[]}]
    skus: [], // [{spec: [v0,v1,v2], stock, price|null, image|null}]
    images: [], // [{role, file}]
    extensions: {}, // 扩展袋：保质期/净含量/配料/功效/型号/重量...
  }
}
export function validateProduct(p) {
  const errors = [], warnings = []
  if (!p.name || typeof p.name !== 'string') errors.push('缺少商品名')
  if (!p.category || typeof p.category !== 'string') errors.push('缺少分类')
  if (!Number.isSafeInteger(p.price) || p.price < 0) errors.push('价格须为非负整数（分）')
  if (!Number.isSafeInteger(p.stock) || p.stock < 0) errors.push('库存须为非负整数')
  if (!p.mainImage) errors.push('缺少主图')
  if (!['free', 'template', 'fixed'].includes(p.freightMode)) errors.push('运费方式须为 free/template/fixed 之一')
  if (p.freightMode === 'fixed' && (!Number.isSafeInteger(p.freightFixed) || p.freightFixed < 0)) errors.push('固定运费须为非负整数（分）')
  if (!Array.isArray(p.specDims) || p.specDims.length > 3) errors.push('规格维度须为 0-3 维')
  for (const d of p.specDims || []) {
    if (!d.name) errors.push('规格维度缺少维名')
    if (!Array.isArray(d.values) || !d.values.length) errors.push(`规格维度 ${d.name || '?'} 缺少取值`)
    if (new Set(d.values).size !== d.values.length) errors.push(`规格维度 ${d.name} 取值重复`)
  }
  const combos = (p.specDims || []).reduce((n, d) => n * d.values.length, 1)
  if (combos > 400) errors.push(`规格组合 ${combos} 个超过 400 上限`)
  if (Array.isArray(p.skus) && p.skus.length) {
    for (const s of p.skus) {
      if (!Array.isArray(s.spec) || s.spec.length !== (p.specDims || []).length) errors.push('SKU 规格组合与维度数不一致')
      if (!Number.isSafeInteger(s.stock) || s.stock < 0) errors.push('SKU 库存须为非负整数')
    }
    if (p.specDims.length && p.skus.length !== combos) warnings.push(`SKU 行数 ${p.skus.length} 与规格组合数 ${combos} 不一致，缺失组合将按默认库存补齐`)
  }
  for (const img of p.images || []) {
    if (!IMAGE_ROLES.includes(img.role)) errors.push(`图片角色非法：${img.role}`)
    if (!img.file) errors.push('图片缺少文件名')
  }
  return { errors, warnings }
}
export function expandSkus(p) {
  // 无 SKU 明细时按维度笛卡尔积展开，库存均分到各组合（余数归首个组合）
  if (p.skus && p.skus.length) return p
  const dims = p.specDims || []
  let combos = [[]]
  for (const d of dims) combos = combos.flatMap(c => d.values.map(v => [...c, v]))
  const base = Math.floor(p.stock / combos.length), rem = p.stock % combos.length
  p.skus = combos.map((spec, i) => ({ spec, stock: base + (i === 0 ? rem : 0), price: null, image: null }))
  return p
}
