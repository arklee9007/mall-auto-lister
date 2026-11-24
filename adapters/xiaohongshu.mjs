// 适配器 F：小红书。字段映射完整版（第二轮）：
// 字段、必填项、规格维（颜色/尺码/容量等多规格）、图片要求（主图至少 3 张，食品须标签实拍图）、
// 上下架状态名（售卖中/已下架/待审核/审核中/审核不通过）均已按公开资料写死，
// 规格维上限与 SKU 上限未查到公开资料，仍标待实测、不编造。
// 状态：未接通平台接口。translate 只做纯字段映射（不碰网络与数据库）；
// 写入口一律抛错，绝不返回假成功。接口调用层口子见 connect()：方法名与参数已定死，
// 接口一通只需把方法体换成真实请求，不改调用方。接通步骤见方案第三章 3.5。
import { platformFieldMap } from '../lib/platform-fields.mjs'
import { freightCheck, imageCheckNotes, skuCheckNotes } from '../lib/platform-translate.mjs'
import { connect as connectApi, STANDARD_METHODS } from '../lib/api-client.mjs'
export const TARGET = 'xiaohongshu'
export const INTERFACE_VERSION = 2
export const CAPABILITIES = { implemented: false, maxSpecDims: 3, specNamesConfigurable: true, extensionBag: false, specImages: true, freightModes: ['free', 'template', 'fixed'], scheduling: true, skuMax: null }
// 上下架状态：售卖中为可售态；待审核/审核中/审核不通过为审核态。引擎只认 state 字符串，profile.schedule.sellableStates 里填 ['售卖中']。
export const SHELF = { onShelf: '售卖中', offShelf: '已下架', sellableStates: ['售卖中'], auditStates: ['待审核', '审核中', '审核不通过'], bannedStates: [] }
export const CONNECTION_SHAPE = [
  { key: 'appKey', label: '小红书电商开放平台应用 AppKey', required: true },
  { key: 'appSecret', label: '小红书电商开放平台应用 AppSecret', required: true },
  { key: 'accessToken', label: '商家授权后的 access_token（OAuth）', required: true },
  { key: 'shopId', label: '小红书店铺 ID', required: true },
]
export const API_METHODS = STANDARD_METHODS
// 接通前还缺什么（不自己猜，逐项列出，须 Sam/买家定夺）：
// - 入驻主体：企业店或个体店主体资质；个人开发者基本拿不到开放平台权限，须认证服务商或企业主体；
// - 授权方式：小红书电商开放平台应用＋商家 OAuth 授权，权限范围含商品/订单/库存/售后；
// - 品牌授权：品牌商品须品牌方正规授权文件（2026 新规：全球购美妆个护采销凭证不再认可），无合规授权新品直接驳回；
// - 类目资质：按类目备齐资质（如食品经营许可证），食品须标签实拍图。
export const REQUIRED_ONBOARDING = [
  { item: '入驻主体', detail: '企业店或个体店主体资质；个人开发者基本拿不到开放平台权限，须认证服务商或企业主体', owner: 'Sam/买家定夺用哪家主体' },
  { item: '开放平台授权', detail: '小红书电商开放平台应用＋商家 OAuth 授权，权限范围含商品/订单/库存/售后', owner: 'Sam/买家授权，凭据只进目标连接配置' },
  { item: '品牌授权', detail: '品牌商品须品牌方正规授权文件（2026 新规：全球购美妆个护采销凭证不再认可），无合规授权新品直接驳回', owner: 'Sam/买家提供' },
  { item: '类目资质', detail: '按类目备齐资质（如食品经营许可证）；食品须标签实拍图', owner: 'Sam/买家提供' },
]
const NOT_CONNECTED = '平台接口未接通：须先完成小红书电商开放平台入驻与商家授权，再实现写入口（见方案第三章 3.5；还缺什么见 REQUIRED_ONBOARDING）'
export function fieldMap() { return platformFieldMap('xiaohongshu') }
export function connectClient(connection) { return connectApi(TARGET, '小红书', connection, CONNECTION_SHAPE, API_METHODS, '先完成小红书电商开放平台入驻与商家授权。') }
export function connect(connection) { return connectClient(connection) }
// 中间格式 → 小红书字段名映射（纯翻译）。平台必填缺失时列进 missingRequired，不静默。
export function translate(product, profile = {}) {
  const notes = []
  const dims = product.specDims || []
  const fm = fieldMap()
  const categoryFields = fm.categoryFields[product.category] || []
  const missingRequired = []
  if (!product.name) missingRequired.push('商品标题')
  if (!product.category) missingRequired.push('类目')
  if (!product.mainImage) missingRequired.push('主图')
  if (!product.skus?.length) missingRequired.push('规格SKU（价格/库存）')
  if (product.category === '食品') notes.push('食品类目：须按标签属性逐项核对（食品名称/净含量/配料表/生产日期/保质期/贮存条件/产品标准代号/SC编号/营养成分表），缺失不得提交')
  for (const [key, val] of Object.entries(product.extensions || {})) notes.push(`扩展字段 ${key}=${val}：小红书须按类目属性表核对落点，暂记未写入`)
  const specImgs = (product.images || []).filter(i => i.role === 'spec')
  if (specImgs.length) notes.push(`规格图 ${specImgs.length} 张：小红书 SKU 可传规格图，接通后按 SKU 回填`)
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (fr.resolved.error) missingRequired.push('运费模板')
  else if (product.freightMode === 'template') notes.push(`运费：${fr.resolved.summary}`)
  notes.push(...imageCheckNotes(product, fm.imageRules, '小红书'))
  notes.push(...skuCheckNotes(product, fm, '小红书'))
  return {
    payload: {
      商品标题: product.name, 类目: product.category, 商品描述: product.description,
      主图: [product.mainImage], 详情图: (product.images || []).filter(i => i.role === 'detail' || i.role === 'info').map(i => i.file),
      规格: dims.map(d => ({ 规格名: d.name, 规格值: d.values })),
      SKU: product.skus.map(s => ({ 规格组合: s.spec, 库存: s.stock, 价格分: s.price })),
      价格分: product.price, 运费方式: product.freightMode, 固定运费分: product.freightFixed, 运费模板名: fr.resolved.templateName || product.freightTemplate, 运费说明: fr.resolved.summary,
      类目扩展字段: categoryFields, 扩展字段: product.extensions || {},
    },
    notes,
    missingRequired,
  }
}
export function createDraft() { throw new Error(NOT_CONNECTED) }
export function readState() { throw new Error(NOT_CONNECTED) }
export function setShelf() { throw new Error(NOT_CONNECTED) }
