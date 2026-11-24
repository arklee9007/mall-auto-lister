// 适配器 E：淘宝。字段映射完整版（第二轮）：
// 字段、必填项、规格维（颜色/尺码等多规格，每规格值设价格库存、可传规格图）、图片要求
// （主图 5 张、800x800 为多家卖家教程口径，官方未明文，以后台为准）、上下架状态名
// （出售中的宝贝 / 仓库中的宝贝）均已按公开资料写死，查不到的仍标待实测。
// 状态：未接通平台接口。translate 只做纯字段映射（不碰网络与数据库）；
// 写入口一律抛错，绝不返回假成功。接口调用层口子见 connect()：方法名与参数已定死，
// 接口一通只需把方法体换成真实请求，不改调用方。接通步骤见方案第三章 3.5。
import { platformFieldMap } from '../lib/platform-fields.mjs'
import { freightCheck, imageCheckNotes, skuCheckNotes } from '../lib/platform-translate.mjs'
import { connect as connectApi, STANDARD_METHODS } from '../lib/api-client.mjs'
export const TARGET = 'taobao'
export const INTERFACE_VERSION = 2
export const CAPABILITIES = { implemented: false, maxSpecDims: 3, specNamesConfigurable: true, extensionBag: false, specImages: true, freightModes: ['free', 'template', 'fixed'], scheduling: true, skuMax: 80 }
// 上下架状态：出售中为可售态，下架商品进仓库。引擎只认 state 字符串，profile.schedule.sellableStates 里填 ['出售中']。
export const SHELF = { onShelf: '出售中', offShelf: '仓库中', sellableStates: ['出售中'], auditStates: [], bannedStates: [] }
export const CONNECTION_SHAPE = [
  { key: 'appKey', label: '淘宝开放平台应用 AppKey', required: true },
  { key: 'appSecret', label: '淘宝开放平台应用 AppSecret', required: true },
  { key: 'sessionKey', label: '商家 OAuth 授权后的 SessionKey', required: true },
  { key: 'shopNick', label: '淘宝店铺昵称（用于核对授权店铺）', required: true },
]
export const API_METHODS = STANDARD_METHODS
// 接通前还缺什么（不自己猜，逐项列出，须 Sam/买家定夺）：
// - 入驻主体：淘宝个人店或企业店（天猫为另一套入驻口径，不在此适配器内）；
// - 授权方式：淘宝开放平台（TOP）建应用，商家 OAuth 授权拿 SessionKey，调用须 HMAC-SHA256 签名；
// - 先行设置：运费模板与发货地须先在千牛后台建好（发布时只填模板名）；
// - 类目属性：细粒度必填以类目属性表为准，发布前须按类目取属性表核对。
export const REQUIRED_ONBOARDING = [
  { item: '入驻主体', detail: '淘宝个人店或企业店（天猫为另一套入驻口径，不在此适配器内）', owner: 'Sam/买家定夺用哪家主体' },
  { item: '开放平台授权', detail: '淘宝开放平台建应用，商家 OAuth 授权拿 SessionKey；调用须 AppKey＋AppSecret＋SessionKey＋HMAC-SHA256 签名', owner: 'Sam/买家授权，凭据只进目标连接配置' },
  { item: '先行模板', detail: '运费模板与发货地先在千牛后台建好，工具只填模板名', owner: 'Sam/买家在千牛后台建好' },
  { item: '类目属性', detail: '细粒度必填以类目属性表为准，发布前须按类目取属性表核对', owner: '接通时以 TOP 当期文档为准' },
]
const NOT_CONNECTED = '平台接口未接通：须先完成淘宝开放平台入驻与商家授权，再实现写入口（见方案第三章 3.5；还缺什么见 REQUIRED_ONBOARDING）'
export function fieldMap() { return platformFieldMap('taobao') }
export function connectClient(connection) { return connectApi(TARGET, '淘宝', connection, CONNECTION_SHAPE, API_METHODS, '先完成淘宝开放平台入驻与商家授权。') }
export function connect(connection) { return connectClient(connection) }
// 中间格式 → 淘宝字段名映射（纯翻译）。平台必填缺失时列进 missingRequired，不静默。
export function translate(product, profile = {}) {
  const notes = []
  const dims = product.specDims || []
  const fm = fieldMap()
  const categoryFields = fm.categoryFields[product.category] || []
  const missingRequired = []
  if (!product.name) missingRequired.push('宝贝标题')
  if (!product.category) missingRequired.push('商品类目')
  if (!product.description) missingRequired.push('宝贝描述')
  if (!product.mainImage) missingRequired.push('主图')
  if (!product.skus?.length) missingRequired.push('规格SKU（价格/库存）')
  if (!(product.extensions || {}).brand) missingRequired.push('品牌（无品牌请选“无品牌”，避免降权与知识产权纠纷）')
  for (const [key, val] of Object.entries(product.extensions || {})) notes.push(`扩展字段 ${key}=${val}：淘宝须按类目属性表核对落点，暂记未写入`)
  const specImgs = (product.images || []).filter(i => i.role === 'spec')
  if (specImgs.length) notes.push(`规格图 ${specImgs.length} 张：淘宝每规格值可传规格图，接通后按 SKU 回填`)
  const fr = freightCheck(product, profile)
  if (fr.note) notes.push(fr.note)
  if (fr.resolved.error) missingRequired.push('运费模板')
  else if (product.freightMode === 'template') notes.push(`运费：${fr.resolved.summary}`)
  notes.push(...imageCheckNotes(product, fm.imageRules, '淘宝'))
  notes.push(...skuCheckNotes(product, fm, '淘宝'))
  return {
    payload: {
      宝贝标题: product.name, 商品类目: product.category, 宝贝描述: product.description,
      主图: [product.mainImage], 详情图: (product.images || []).filter(i => i.role === 'detail' || i.role === 'info').map(i => i.file),
      规格: dims.map(d => ({ 规格名: d.name, 规格值: d.values })),
      SKU: product.skus.map(s => ({ 规格组合: s.spec, 库存: s.stock, 价格分: s.price })),
      一口价分: product.price, 运费方式: product.freightMode, 固定运费分: product.freightFixed, 运费模板名: fr.resolved.templateName || product.freightTemplate, 运费说明: fr.resolved.summary,
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
