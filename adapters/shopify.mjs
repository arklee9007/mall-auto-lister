// 适配器 G：Shopify（自建独立站）。通用适配器（字段映射版，第二轮）：
// 按 Shopify 商品 CSV 公开列名翻译：Title 为新商品唯一必填；多规格/更新时须 URL handle；
// 规格选项上限 3（Option1–3）、单商品最多 2048 个组合、250 张图、CSV 上限 15MB。
// 运费：Shopify 商品本身无运费模板字段，运费在后台 Shipping and delivery 按区域与费率设置，
// 适配器把运费映射写进备注，买家须在后台建好对应费率。
// 状态：未接通接口。translate 只做纯字段映射；写入口抛错，不返回假成功。
// 接口调用层口子见 connect()：方法名与参数已定死，接口一通只需把方法体换成真实请求。
import { storefrontFieldMap } from '../lib/storefront-fields.mjs'
import { freightCheck, imageCheckNotes, skuCheckNotes } from '../lib/platform-translate.mjs'
import { connect as connectApi, STANDARD_METHODS } from '../lib/api-client.mjs'
export const TARGET = 'shopify'
export const INTERFACE_VERSION = 1
export const CAPABILITIES = { implemented: false, maxSpecDims: 3, specNamesConfigurable: true, extensionBag: false, specImages: false, freightModes: ['free', 'template', 'fixed'], scheduling: true, skuMax: 2048 }
export const SHELF = { onShelf: 'active', offShelf: 'draft', sellableStates: ['active'], auditStates: [], bannedStates: ['archived'] }
export const CONNECTION_SHAPE = [
  { key: 'shop', label: 'Shopify 店铺域名（如 xxx.myshopify.com）', required: true },
  { key: 'accessToken', label: '自定义应用或 OAuth 的 Admin API access_token', required: true },
  { key: 'apiVersion', label: 'Admin API 版本（如 2026-01）', required: false },
]
export const API_METHODS = STANDARD_METHODS
// 接通前还缺什么（不自己猜，逐项列出，须 Sam/买家定夺）：
// - 店铺订阅：Shopify 按月订阅，付费后才可上架售卖；
// - 授权方式：后台建自定义应用或走 OAuth，拿 Admin API access_token；
// - 先行设置：后台 Settings → Shipping and delivery 建好配送区域与费率（商品本身无运费模板字段）；
// - 图片：CSV 导入用图片 URL（Image Src 列），须先把图传到可公开访问的地址或 Shopify Files。
export const REQUIRED_ONBOARDING = [
  { item: '店铺订阅', detail: 'Shopify 按月订阅，付费后才可上架售卖', owner: 'Sam/买家定夺是否开店、花多少钱' },
  { item: 'API 授权', detail: '后台建自定义应用或走 OAuth，拿 Admin API access_token', owner: 'Sam/买家授权，凭据只进目标连接配置' },
  { item: '配送设置', detail: '后台 Settings → Shipping and delivery 建好配送区域与费率', owner: 'Sam/买家在后台建好' },
  { item: '图片地址', detail: 'CSV 导入用图片 URL，须先把图传到可公开访问的地址或 Shopify Files', owner: '接通时按导入方式定' },
]
const NOT_CONNECTED = '接口未接通：须先完成 Shopify 店铺订阅与 Admin API 授权，再实现写入口（还缺什么见 REQUIRED_ONBOARDING）'
export function fieldMap() { return storefrontFieldMap('shopify') }
export function connectClient(connection) { return connectApi(TARGET, 'Shopify', connection, CONNECTION_SHAPE, API_METHODS, '先完成 Shopify 店铺订阅与 Admin API 授权。') }
export function connect(connection) { return connectClient(connection) }
export function slugOf(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'product'
}
// 中间格式 → Shopify 商品 CSV 列名映射（纯翻译）。导入只到草稿：Published 列填 FALSE。
export function translate(product, profile = {}) {
  const notes = []
  const dims = product.specDims || []
  const fm = fieldMap()
  const missingRequired = []
  if (!product.name) missingRequired.push('Title（商品名）')
  if (!product.skus?.length) missingRequired.push('Variant Price / Variant Inventory Qty（规格价格/库存）')
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (fr.resolved.error) missingRequired.push('运费模板')
  notes.push('运费：Shopify 商品无运费模板字段，须在后台 Shipping and delivery 按区域设费率；本单运费映射：' + fr.resolved.summary)
  notes.push(...imageCheckNotes(product, fm.imageRules, 'Shopify'))
  notes.push(...skuCheckNotes(product, fm, 'Shopify'))
  for (const [key, val] of Object.entries(product.extensions || {})) notes.push(`扩展字段 ${key}=${val}：Shopify CSV 无对应列，暂记未写入（可用 Metafield 另存，二期）`)
  const handle = slugOf(product.name)
  const priceYuan = (c) => (Number(c || 0) / 100).toFixed(2)
  const rows = (product.skus || []).map((s, i) => {
    const row = {
      'URL handle': handle, Title: i === 0 ? product.name : '', Description: i === 0 ? (product.description || '') : '',
      Vendor: i === 0 ? ((product.extensions || {}).brand || '') : '', Type: i === 0 ? product.category : '',
      Tags: i === 0 ? (product.keywords || []).join(',') : '', Published: 'FALSE',
      'Option1 Name': dims[0]?.name || '', 'Option1 Value': s.spec[0] || '',
      'Option2 Name': dims[1]?.name || '', 'Option2 Value': s.spec[1] || '',
      'Option3 Name': dims[2]?.name || '', 'Option3 Value': s.spec[2] || '',
      'Variant SKU': `${handle}-${i + 1}`, 'Variant Grams': (product.extensions || {}).weight ? parseFloat(String((product.extensions || {}).weight).replace(/[^\d.]/g, '')) || '' : '',
      'Variant Inventory Qty': s.stock, 'Variant Price': priceYuan(s.price ?? product.price),
      'Variant Requires Shipping': 'TRUE', 'Image Src': i === 0 ? product.mainImage : '', 'Image Alt Text': i === 0 ? product.name : '',
      运费说明: i === 0 ? fr.resolved.summary : '',
    }
    return row
  })
  return { payload: { handle, rows, freightNote: fm.freightNote }, notes, missingRequired }
}
export function createDraft() { throw new Error(NOT_CONNECTED) }
export function readState() { throw new Error(NOT_CONNECTED) }
export function setShelf() { throw new Error(NOT_CONNECTED) }
