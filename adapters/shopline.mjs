// 适配器 J：SHOPLINE。通用适配器（字段映射版，第二轮）：
// 按 SHOPLINE 商品文件公开口径翻译：必填为 Product Handle、Product Name、Images；
// 建议填 Price、Quantity、Categories；规格选项支持 Option1–5（本插件引擎上限 3 维，
// 4–5 维商品须拆包或走定制适配）；商品文件为 CSV 或 XLSX、上限 40MB，模板含两行表头须保留；
// 多规格每组合一行，Title 只填首行。
// 运费：Package（包裹）信息目前不支持商品 CSV 导入导出，运费在后台物流设置，固定运费/模板名写入备注。
// 状态：未接通接口。translate 只做纯字段映射；写入口抛错，不返回假成功。
// 接口调用层口子见 connect()：方法名与参数已定死，接口一通只需把方法体换成真实请求。
import { storefrontFieldMap } from '../lib/storefront-fields.mjs'
import { freightCheck, imageCheckNotes, skuCheckNotes } from '../lib/platform-translate.mjs'
import { connect as connectApi, STANDARD_METHODS } from '../lib/api-client.mjs'
export const TARGET = 'shopline'
export const INTERFACE_VERSION = 1
export const CAPABILITIES = { implemented: false, maxSpecDims: 3, specNamesConfigurable: true, extensionBag: false, specImages: false, freightModes: ['free', 'template', 'fixed'], scheduling: true, skuMax: null }
export const SHELF = { onShelf: 'Activated', offShelf: 'Deactivated', sellableStates: ['Activated'], auditStates: [], bannedStates: [] }
export const CONNECTION_SHAPE = [
  { key: 'shop', label: 'SHOPLINE 店铺域名', required: true },
  { key: 'appKey', label: 'SHOPLINE 开放平台应用 AppKey', required: true },
  { key: 'appSecret', label: 'SHOPLINE 开放平台应用 AppSecret', required: true },
  { key: 'accessToken', label: '商家授权后的 access_token（OAuth）', required: true },
]
export const API_METHODS = STANDARD_METHODS
// 接通前还缺什么（不自己猜，逐项列出，须 Sam/买家定夺）：
// - 店铺订阅：SHOPLINE 店铺订阅（版本与费用按当期套餐，须 Sam 定）；
// - 授权方式：SHOPLINE 开放平台建应用，商家 OAuth 授权；批量导入也可不走 API，直接用后台商品文件；
// - 先行设置：分类与供应商须先在后台建好（批量导入不能新建分类与供应商）；后台物流设置须建好；
// - 导入模板：以后台下载的商品模板为准（两行表头都保留，列名与顺序不改），文件上限 40MB。
export const REQUIRED_ONBOARDING = [
  { item: '店铺订阅', detail: 'SHOPLINE 店铺订阅（版本与费用按当期套餐）', owner: 'Sam/买家定夺开不开、花多少钱' },
  { item: '开放平台授权', detail: 'SHOPLINE 开放平台建应用，商家 OAuth 授权；批量导入也可不走 API，直接用后台商品文件', owner: 'Sam/买家授权，凭据只进目标连接配置' },
  { item: '先行设置', detail: '分类与供应商先在后台建好（批量导入不能新建）；后台物流设置建好', owner: 'Sam/买家在后台建好' },
  { item: '导入模板', detail: '以后台下载的商品模板为准（两行表头都保留，列名与顺序不改），文件上限 40MB', owner: '导入时以后台当期模板核对' },
]
const NOT_CONNECTED = '接口未接通：须先完成 SHOPLINE 店铺订阅与开放平台授权，再实现写入口（还缺什么见 REQUIRED_ONBOARDING）'
export function fieldMap() { return storefrontFieldMap('shopline') }
export function connectClient(connection) { return connectApi(TARGET, 'SHOPLINE', connection, CONNECTION_SHAPE, API_METHODS, '先完成 SHOPLINE 店铺订阅与开放平台授权。') }
export function connect(connection) { return connectClient(connection) }
// 中间格式 → SHOPLINE 商品文件列名映射（纯翻译）。导入只到下架草稿：Status 填 Deactivated、Visibility 填 Hidden。
export function translate(product, profile = {}) {
  const notes = []
  const dims = product.specDims || []
  const fm = fieldMap()
  const missingRequired = []
  if (!product.name) missingRequired.push('Product Name（商品名）')
  if (!product.mainImage) missingRequired.push('Images（图片）')
  if (!product.skus?.length) missingRequired.push('Price / Quantity（价格/库存）')
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (fr.resolved.error) missingRequired.push('运费模板')
  notes.push('运费：Package 信息不支持商品 CSV 导入导出，运费在后台物流设置；本单运费映射：' + fr.resolved.summary)
  notes.push(...imageCheckNotes(product, fm.imageRules, 'SHOPLINE'))
  notes.push(...skuCheckNotes(product, fm, 'SHOPLINE'))
  if (dims.length > 3) notes.push('SHOPLINE 支持 Option1–5 共 5 个规格选项，本插件引擎上限 3 维，4–5 维商品请拆包或走定制适配')
  for (const [key, val] of Object.entries(product.extensions || {})) notes.push(`扩展字段 ${key}=${val}：SHOPLINE 商品文件无对应列，暂记未写入`)
  const handle = String(product.name || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'product'
  const priceYuan = (c) => (Number(c || 0) / 100).toFixed(2)
  const rows = (product.skus || []).map((s, i) => ({
    Handle: handle, Title: i === 0 ? product.name : '', Description: i === 0 ? (product.description || '') : '',
    Categories: i === 0 ? product.category : '', Tags: i === 0 ? (product.keywords || []).join(',') : '',
    Status: 'Deactivated', Visibility: 'Hidden',
    'Option1 Name': dims[0]?.name || '', 'Option1 Value': s.spec[0] || '',
    'Option2 Name': dims[1]?.name || '', 'Option2 Value': s.spec[1] || '',
    'Option3 Name': dims[2]?.name || '', 'Option3 Value': s.spec[2] || '',
    Price: priceYuan(s.price ?? product.price), Quantity: s.stock,
    SKU: `${handle}-${i + 1}`, Images: i === 0 ? product.mainImage : '',
    运费说明: i === 0 ? fr.resolved.summary : '',
  }))
  return { payload: { handle, rows, freightNote: fm.freightNote }, notes, missingRequired }
}
export function createDraft() { throw new Error(NOT_CONNECTED) }
export function readState() { throw new Error(NOT_CONNECTED) }
export function setShelf() { throw new Error(NOT_CONNECTED) }
