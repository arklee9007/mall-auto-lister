// 适配器 C：无后台文件版。只出标准商品表（CSV）+ 改好名的图片包，不接数据库，上下架不适用。
// 标准表头固定；规格维展平为 规格1名/规格1值/规格2名/规格2值/规格3名/规格3值；扩展袋单列 JSON。
import { toCsv } from '../lib/csv.mjs'
export const TARGET = 'file-only'
export const CAPABILITIES = { maxSpecDims: 3, extensionBag: true, specImages: true, scheduling: false }
export function translate(product, profile) {
  const dims = product.specDims || []
  const row = {
    商品名: product.name, 分类: product.category, 价格分: product.price, 库存: product.stock,
    主图: product.mainImage, 运费方式: product.freightMode, 固定运费分: product.freightFixed || '',
    描述: product.description, 副标题: product.subtitle, 关键词: (product.keywords || []).join(','),
  }
  for (let i = 0; i < 3; i++) {
    row[`规格${i + 1}名`] = dims[i]?.name || ''
    row[`规格${i + 1}值`] = (dims[i]?.values || []).join(',')
  }
  row['扩展字段'] = JSON.stringify(product.extensions || {})
  row['图片'] = (product.images || []).map(i => `${i.role}:${i.file}`).join(';')
  row['SKU明细'] = product.skus.map(s => `${s.spec.join('/')}x${s.stock}`).join(';')
  return { payload: row, notes: [] }
}
export function renderSheet(products, profile) {
  const headers = ['商品名', '分类', '价格分', '库存', '主图', '运费方式', '固定运费分', '描述', '副标题', '关键词', '规格1名', '规格1值', '规格2名', '规格2值', '规格3名', '规格3值', '扩展字段', '图片', 'SKU明细']
  const rows = products.map(p => { const { payload } = translate(p, profile); return headers.map(h => payload[h] ?? '') })
  return toCsv([headers, ...rows])
}
// 图片改名规则：<商品序号>_<角色>_<原名>，角色与中间格式一致。
export function renameImages(products) {
  const plan = []
  products.forEach((p, i) => {
    for (const img of p.images || []) plan.push({ from: img.file, to: `${String(i + 1).padStart(3, '0')}_${img.role}_${img.file.split('/').pop()}` })
  })
  return plan
}
