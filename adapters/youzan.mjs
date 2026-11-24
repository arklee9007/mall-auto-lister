// 适配器 I：有赞微商城。通用适配器（字段映射版，第二轮）：
// 按有赞官方文章的发布与批量导入口径翻译：发布页必填为商品名称、商品图、价格、库存；
// 批量导入走后台 商品中心 → 商品库 → 商品导入 → 下载模板（须用当期模板，旧模板不建议沿用）；
// 状态分三段：已导入商品库 ≠ 已发布到店铺 ≠ 已上架可售，导入只到商品库。
// 运费：发布页物流信息里填发货地、配送范围、运费规则；运费模板须先在有赞后台物流设置里建好，工具只填模板名。
// 状态：未接通接口。translate 只做纯字段映射；写入口抛错，不返回假成功。
// 接口调用层口子见 connect()：方法名与参数已定死，接口一通只需把方法体换成真实请求。
import { storefrontFieldMap } from '../lib/storefront-fields.mjs'
import { freightCheck, imageCheckNotes, skuCheckNotes } from '../lib/platform-translate.mjs'
import { connect as connectApi, STANDARD_METHODS } from '../lib/api-client.mjs'
export const TARGET = 'youzan'
export const INTERFACE_VERSION = 1
export const CAPABILITIES = { implemented: false, maxSpecDims: 3, specNamesConfigurable: true, extensionBag: false, specImages: true, freightModes: ['free', 'template', 'fixed'], scheduling: true, skuMax: null }
export const SHELF = { onShelf: '已上架', offShelf: '已下架', sellableStates: ['已上架'], auditStates: [], bannedStates: [] }
export const CONNECTION_SHAPE = [
  { key: 'appKey', label: '有赞云开放平台应用 AppKey', required: true },
  { key: 'appSecret', label: '有赞云开放平台应用 AppSecret', required: true },
  { key: 'accessToken', label: '商家授权后的 access_token（OAuth）', required: true },
  { key: 'shopId', label: '有赞店铺 ID', required: true },
]
export const API_METHODS = STANDARD_METHODS
// 接通前还缺什么（不自己猜，逐项列出，须 Sam/买家定夺）：
// - 店铺：有赞微商城店铺（版本与费用按有赞当期套餐，须 Sam 定）；
// - 授权方式：有赞云开放平台建应用，商家 OAuth 授权；批量导入也可不走 API，直接用后台模板；
// - 先行设置：物流设置里建好运费规则、发货地、配送范围；分类须先在后台建好（批量导入不能新建分类）；
// - 导入模板：以后台当期下载的模板为准，模板列名与填写规则以模板提示为准，不沿用旧模板。
export const REQUIRED_ONBOARDING = [
  { item: '店铺版本', detail: '有赞微商城店铺（版本与费用按有赞当期套餐）', owner: 'Sam/买家定夺开不开、花多少钱' },
  { item: '开放平台授权', detail: '有赞云开放平台建应用，商家 OAuth 授权；批量导入也可不走 API，直接用后台模板', owner: 'Sam/买家授权，凭据只进目标连接配置' },
  { item: '先行设置', detail: '物流设置里建好运费规则、发货地、配送范围；分类先在后台建好（批量导入不能新建分类）', owner: 'Sam/买家在后台建好' },
  { item: '导入模板', detail: '以后台当期下载的模板为准，列名与填写规则以模板提示为准，不沿用旧模板', owner: '导入时以后台当期模板核对' },
]
const NOT_CONNECTED = '接口未接通：须先完成有赞店铺与有赞云开放平台授权，再实现写入口（还缺什么见 REQUIRED_ONBOARDING）'
export function fieldMap() { return storefrontFieldMap('youzan') }
export function connectClient(connection) { return connectApi(TARGET, '有赞微商城', connection, CONNECTION_SHAPE, API_METHODS, '先完成有赞店铺与有赞云开放平台授权。') }
export function connect(connection) { return connectClient(connection) }
// 中间格式 → 有赞商品字段映射（纯翻译）。导入只到商品库：状态填“商品库”，不直接发布、不上架。
export function translate(product, profile = {}) {
  const notes = []
  const dims = product.specDims || []
  const fm = fieldMap()
  const missingRequired = []
  if (!product.name) missingRequired.push('商品名称')
  if (!product.mainImage) missingRequired.push('商品图')
  if (!product.skus?.length) missingRequired.push('规格SKU（价格/库存）')
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (fr.resolved.error) missingRequired.push('运费模板')
  else if (product.freightMode === 'template') notes.push(`运费：${fr.resolved.summary}`)
  notes.push(...imageCheckNotes(product, fm.imageRules, '有赞'))
  notes.push(...skuCheckNotes(product, fm, '有赞'))
  for (const [key, val] of Object.entries(product.extensions || {})) notes.push(`扩展字段 ${key}=${val}：有赞须按商品库模板列名核对落点，暂记未写入`)
  return {
    payload: {
      商品名称: product.name, 商品图: product.mainImage, 详情图: (product.images || []).filter(i => i.role === 'detail' || i.role === 'info').map(i => i.file),
      价格元: (Number(product.price || 0) / 100).toFixed(2), 库存: product.stock,
      商品编码: (product.extensions || {}).model || '', 规格项: dims.map(d => ({ 规格名: d.name, 规格值: d.values })),
      SKU: product.skus.map(s => ({ 规格组合: s.spec, 库存: s.stock, 价格元: ((s.price ?? product.price) / 100).toFixed(2) })),
      物流信息: { 运费方式: product.freightMode, 固定运费元: ((product.freightFixed || 0) / 100).toFixed(2), 运费模板名: fr.resolved.templateName || product.freightTemplate, 运费说明: fr.resolved.summary },
      商品详情: product.description || '', 状态: '商品库',
      类目扩展字段: fm.categoryFields[product.category] || [], 扩展字段: product.extensions || {},
    },
    notes,
    missingRequired,
  }
}
export function createDraft() { throw new Error(NOT_CONNECTED) }
export function readState() { throw new Error(NOT_CONNECTED) }
export function setShelf() { throw new Error(NOT_CONNECTED) }
