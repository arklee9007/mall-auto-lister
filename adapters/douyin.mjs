// 适配器 D：抖音（抖店）。字段映射完整版（第二轮）：
// 字段、必填项、规格维（API 销售属性最多 3 类、SKU 上限 300）、图片要求（主图 5–9 张）、
// 上下架状态名（售卖中/已下架/审核中/审核不通过/封禁）均已按公开资料写死，查不到的仍标待实测。
// 状态：未接通平台接口。translate 只做纯字段映射（不碰网络与数据库）；
// 写入口一律抛错，绝不返回假成功。接口调用层口子见 connect()：方法名与参数已定死，
// 接口一通只需把方法体换成真实请求，不改调用方。接通步骤见方案第三章 3.5。
import { platformFieldMap } from '../lib/platform-fields.mjs'
import { freightCheck, imageCheckNotes, skuCheckNotes } from '../lib/platform-translate.mjs'
import { connect as connectApi, STANDARD_METHODS } from '../lib/api-client.mjs'
export const TARGET = 'douyin'
export const INTERFACE_VERSION = 2
export const CAPABILITIES = { implemented: false, maxSpecDims: 3, specNamesConfigurable: true, extensionBag: false, specImages: true, freightModes: ['free', 'template', 'fixed'], scheduling: true, skuMax: 300 }
// 上下架状态：售卖中为可售态；其余为下架/审核/处罚态。引擎只认 state 字符串，profile.schedule.sellableStates 里填 ['售卖中']。
export const SHELF = { onShelf: '售卖中', offShelf: '已下架', sellableStates: ['售卖中'], auditStates: ['审核中', '审核不通过'], bannedStates: ['封禁'] }
export const CONNECTION_SHAPE = [
  { key: 'appKey', label: '抖店开放平台应用 AppKey', required: true },
  { key: 'appSecret', label: '抖店开放平台应用 AppSecret', required: true },
  { key: 'accessToken', label: '商家授权后的 access_token（OAuth）', required: true },
  { key: 'shopId', label: '抖店店铺 ID', required: true },
]
export const API_METHODS = STANDARD_METHODS
// 接通前还缺什么（不自己猜，逐项列出，须 Sam/买家定夺）：
// - 入驻主体：个体工商户或企业营业执照开抖店（个人店限部分类目），保证金按类目交；
// - 授权方式：抖店开放平台建应用，商家 OAuth 授权拿 access_token，Token 有有效期、须刷新机制；
// - 先行设置：运费模板、规格模板、品牌模板须先在抖店后台建好（建商品时只填模板名/ID）；
// - 类目资质：按品类上传质检报告、商标注册证或商标使用授权书，每次建新商品均须传。
export const REQUIRED_ONBOARDING = [
  { item: '入驻主体', detail: '个体工商户或企业营业执照开抖店（个人店限部分类目）；保证金按类目交', owner: 'Sam/买家在抖店后台操作，Cooper 不代登录' },
  { item: '开放平台授权', detail: '抖店开放平台建应用，商家 OAuth 授权拿 access_token；Token 有有效期，须刷新机制', owner: 'Sam/买家授权，凭据只进目标连接配置' },
  { item: '先行模板', detail: '运费模板、规格模板、品牌模板先在抖店后台建好，工具只填模板名', owner: 'Sam/买家在抖店后台建好' },
  { item: '类目资质', detail: '按品类上传质检报告、商标注册证或商标使用授权书；每次建新商品均须传', owner: 'Sam/买家提供' },
]
const NOT_CONNECTED = '平台接口未接通：须先完成抖店开放平台入驻与商家授权，再实现写入口（见方案第三章 3.5；还缺什么见 REQUIRED_ONBOARDING）'
export function fieldMap() { return platformFieldMap('douyin') }
export function connectClient(connection) { return connectApi(TARGET, '抖音（抖店）', connection, CONNECTION_SHAPE, API_METHODS, '先完成抖店开放平台入驻与商家授权。') }
export function connect(connection) { return connectClient(connection) }
// 中间格式 → 抖店字段名映射（纯翻译）。平台必填缺失时列进 missingRequired，不静默。
export function translate(product, profile = {}) {
  const notes = []
  const dims = product.specDims || []
  const fm = fieldMap()
  const categoryFields = fm.categoryFields[product.category] || []
  const missingRequired = []
  if (!product.name) missingRequired.push('商品标题')
  if (!product.category) missingRequired.push('类目')
  if (!product.description) missingRequired.push('商品描述')
  if (!product.mainImage) missingRequired.push('主图')
  if (!product.skus?.length) missingRequired.push('规格SKU（价格/库存）')
  if (!(product.extensions || {}).brand) missingRequired.push('品牌（无品牌请填“无品牌”；品牌商品须授权）')
  if (product.category === '服装') notes.push('服装类：尺码表为必填，请核对尺码表已随商品提交')
  for (const [key, val] of Object.entries(product.extensions || {})) notes.push(`扩展字段 ${key}=${val}：抖店须按类目属性表（Get Attributes 返回）核对落点，暂记未写入`)
  const specImgs = (product.images || []).filter(i => i.role === 'spec')
  if (specImgs.length) notes.push(`规格图 ${specImgs.length} 张：抖店 SKU 可传规格图，接通后按 SKU 回填`)
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (fr.resolved.error) missingRequired.push('运费模板')
  else if (product.freightMode === 'template') notes.push(`运费：${fr.resolved.summary}`)
  notes.push(...imageCheckNotes(product, fm.imageRules, '抖店'))
  notes.push(...skuCheckNotes(product, fm, '抖店'))
  return {
    payload: {
      商品标题: product.name, 类目: product.category, 商品描述: product.description,
      主图: [product.mainImage], 详情图: (product.images || []).filter(i => i.role === 'detail' || i.role === 'info').map(i => i.file),
      规格: dims.map(d => ({ 规格名: d.name, 规格值: d.values })),
      SKU: product.skus.map(s => ({ 规格组合: s.spec, 库存: s.stock, 价格分: s.price })),
      运费方式: product.freightMode, 固定运费分: product.freightFixed, 运费模板名: fr.resolved.templateName || product.freightTemplate, 运费说明: fr.resolved.summary,
      品牌: (product.extensions || {}).brand || '',
      类目扩展字段: categoryFields, 扩展字段: product.extensions || {},
    },
    notes,
    missingRequired,
  }
}
export function createDraft() { throw new Error(NOT_CONNECTED) }
export function readState() { throw new Error(NOT_CONNECTED) }
export function setShelf() { throw new Error(NOT_CONNECTED) }
