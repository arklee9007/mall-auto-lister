// 适配器 H：WooCommerce（WordPress 自建店）。通用适配器（字段映射版，第二轮）：
// 按 WooCommerce 内置导入 CSV 公开列名翻译：Name 为唯一必填；Type 非简单商品时必填；
// SKU 强烈建议（更新去重靠它）；Published 列 1 上架 / 0 草稿；图片用完整 URL。
// 运费：按配送区域＋运费方式在后台设置；商品可指定 Shipping class（运费等级），
// 适配器把固定运费/模板名写入 Shipping class 备注，买家须在后台建好对应等级。
// 状态：未接通接口。translate 只做纯字段映射；写入口抛错，不返回假成功。
// 接口调用层口子见 connect()：方法名与参数已定死，接口一通只需把方法体换成真实请求。
import { storefrontFieldMap } from '../lib/storefront-fields.mjs'
import { freightCheck, imageCheckNotes, skuCheckNotes } from '../lib/platform-translate.mjs'
import { connect as connectApi, STANDARD_METHODS } from '../lib/api-client.mjs'
export const TARGET = 'woocommerce'
export const INTERFACE_VERSION = 1
export const CAPABILITIES = { implemented: false, maxSpecDims: 3, specNamesConfigurable: true, extensionBag: false, specImages: false, freightModes: ['free', 'template', 'fixed'], scheduling: true, skuMax: null }
export const SHELF = { onShelf: 'publish', offShelf: 'draft', sellableStates: ['publish'], auditStates: [], bannedStates: ['private'] }
export const CONNECTION_SHAPE = [
  { key: 'siteUrl', label: 'WordPress 站点地址（如 https://你的域名）', required: true },
  { key: 'consumerKey', label: 'WooCommerce REST API Consumer Key', required: true },
  { key: 'consumerSecret', label: 'WooCommerce REST API Consumer Secret', required: true },
]
export const API_METHODS = STANDARD_METHODS
// 接通前还缺什么（不自己猜，逐项列出，须 Sam/买家定夺）：
// - 站点：自有 WordPress 站点＋ WooCommerce 插件（主机与域名费用另计）；
// - 授权方式：WooCommerce → Settings → Advanced → REST API 建密钥（Consumer Key/Secret）；
// - 先行设置：配送区域与运费方式（统一费率/按重量等）、Shipping class（运费等级）须先在后台建好；
// - 图片：导入用完整图片 URL，须先把图传到可公开访问的地址。
export const REQUIRED_ONBOARDING = [
  { item: '站点', detail: '自有 WordPress 站点＋ WooCommerce 插件（主机与域名费用另计）', owner: 'Sam/买家定夺是否建站、花多少钱' },
  { item: 'API 密钥', detail: 'WooCommerce 后台 REST API 建密钥（Consumer Key/Secret）', owner: 'Sam/买家授权，凭据只进目标连接配置' },
  { item: '配送设置', detail: '配送区域与运费方式、Shipping class（运费等级）先在后台建好', owner: 'Sam/买家在后台建好' },
  { item: '图片地址', detail: '导入用完整图片 URL，须先把图传到可公开访问的地址', owner: '接通时按导入方式定' },
]
const NOT_CONNECTED = '接口未接通：须先完成 WordPress＋WooCommerce 站点与 REST API 密钥，再实现写入口（还缺什么见 REQUIRED_ONBOARDING）'
export function fieldMap() { return storefrontFieldMap('woocommerce') }
export function connectClient(connection) { return connectApi(TARGET, 'WooCommerce', connection, CONNECTION_SHAPE, API_METHODS, '先完成 WordPress＋WooCommerce 站点与 REST API 密钥。') }
export function connect(connection) { return connectClient(connection) }
// 中间格式 → WooCommerce 导入 CSV 列名映射（纯翻译）。导入只到草稿：Published 列填 0。
export function translate(product, profile = {}) {
  const notes = []
  const dims = product.specDims || []
  const fm = fieldMap()
  const missingRequired = []
  if (!product.name) missingRequired.push('Name（商品名）')
  if (!product.skus?.length) missingRequired.push('Regular price / Stock（价格/库存）')
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (fr.resolved.error) missingRequired.push('运费模板')
  notes.push('运费：WooCommerce 运费按配送区域＋运费方式在后台设置；本单运费映射已写入 Shipping class 备注：' + fr.resolved.summary)
  notes.push(...imageCheckNotes(product, fm.imageRules, 'WooCommerce'))
  notes.push(...skuCheckNotes(product, fm, 'WooCommerce'))
  for (const [key, val] of Object.entries(product.extensions || {})) {
    if (key === 'weight') continue // 重量有 Weight 列
    notes.push(`扩展字段 ${key}=${val}：WooCommerce CSV 无对应列，暂记未写入`)
  }
  const priceYuan = (c) => (Number(c || 0) / 100).toFixed(2)
  const isVariable = dims.length > 0
  const attrs = {}
  dims.forEach((d, i) => { attrs[`Attribute ${i + 1} name`] = d.name; attrs[`Attribute ${i + 1} value(s)`] = d.values.join(','); attrs[`Attribute ${i + 1} visible`] = 1; attrs[`Attribute ${i + 1} global`] = 0 })
  return {
    payload: {
      Type: isVariable ? 'variable' : 'simple', SKU: (product.extensions || {}).model || '', Name: product.name,
      Published: 0, 'Short description': product.subtitle || '', Description: product.description || '',
      'Regular price': priceYuan(product.price), Categories: product.category, Tags: (product.keywords || []).join(','),
      Images: [product.mainImage, ...(product.images || []).filter(i => i.role !== 'main').map(i => i.file)].filter(Boolean).join(','),
      Stock: product.stock, 'In stock?': product.stock > 0 ? 1 : 0,
      Weight: (product.extensions || {}).weight || '',
      'Shipping class': product.freightMode === 'free' ? '' : (fr.resolved.templateName || `固定运费${priceYuan(product.freightFixed)}`),
      运费说明: fr.resolved.summary,
      ...attrs,
      Variations: (product.skus || []).map(s => ({ 规格组合: s.spec, 库存: s.stock, 价格元: priceYuan(s.price ?? product.price) })),
    },
    notes,
    missingRequired,
  }
}
export function createDraft() { throw new Error(NOT_CONNECTED) }
export function readState() { throw new Error(NOT_CONNECTED) }
export function setShelf() { throw new Error(NOT_CONNECTED) }
