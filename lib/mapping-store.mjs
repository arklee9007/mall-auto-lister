// 映射配置层：换场景不改代码。配置 = 字段映射表 + 规格维度映射 + 图片规则 + 上下架规则模板 + 时区 + 目标连接配置。
// 凭据只走配置文件（config/targets.json），永不进代码与报告。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateFreightTemplates } from './freight.mjs'
export const DEFAULT_IMAGE_RULES = {
  // 文件名含以下标记即判为该角色；无标记的图片默认进详情图。
  main: ['主图', 'main', 'cover', '_m.'],
  detail: ['详情', 'detail', '_d.'],
  spec: ['规格图', 'spec', '_s.'],
  info: ['说明', '尺码', 'info', 'chart', '_i.'],
}
export const TARGETS = ['generic-template', 'wander', 'file-only', 'douyin', 'taobao', 'xiaohongshu', 'shopify', 'woocommerce', 'youzan', 'shopline']
export function assertTarget(target) {
  if (!TARGETS.includes(target)) throw new Error('target 须为 ' + TARGETS.join(' / ') + ' 之一，当前值：' + target)
}
export const DEFAULT_CONFIG = {
  version: 1,
  profileName: '',
  target: 'generic-template', // generic-template | wander | file-only | douyin | taobao | xiaohongshu | shopify | woocommerce | youzan | shopline
  mapping: null, // proposeMapping 的输出经人工核对后存入
  priceUnit: 'yuan', // 价格列单位：yuan（元）/ fen（分），核对映射时由人确认，程序不再靠数值猜
  // 运费模板（第二轮，买家自设）：freightTemplates 是买家后台已建模板的登记表
  // （模板名、计费方式、区域与价格结构可配，见 lib/freight.mjs blankFreightTemplate）；
  // freightTemplateDefault 是买家明确指定的默认模板名，空 = 不设默认，不静默编默认值。
  freightTemplates: [],
  freightTemplateDefault: '',
  categories: [], // 买家自己的分类清单（generate-template 从样表抽取，人可改）
  specSeparator: '/', // 规格组合列用此分隔符拆维（如 "红/L"）
  specValueSeparator: ',', // 一格多值用此分隔（如 "红,蓝"）
  imageRules: DEFAULT_IMAGE_RULES,
  timezone: 'Asia/Shanghai',
  schedule: { pollMinutes: 5, singleRunCap: 50, sellableStates: ['onShelf'], masterSwitch: true },
}
export function loadProfile(dir, name) {
  const p = join(dir, name + '.json')
  if (!existsSync(p)) throw new Error('映射配置不存在：' + name)
  return JSON.parse(readFileSync(p, 'utf-8'))
}
export function saveProfile(dir, name, profile) {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name + '.json')
  writeFileSync(p, JSON.stringify(profile, null, 2) + '\n', 'utf-8')
  return p
}
export function validateProfile(profile) {
  const errors = []
  if (!profile.mapping) errors.push('缺少 mapping：须先导入模板并核对映射')
  const required = ['name', 'category', 'price', 'stock', 'mainImage', 'freightMode']
  for (const f of required) {
    if (!profile.mapping?.columns?.[f]?.source) errors.push(`必填字段 ${f} 未映射到来源列`)
  }
  if ((profile.mapping?.specDims || []).length > 3) errors.push('规格维度映射超过 3 维')
  if (!TARGETS.includes(profile.target)) errors.push('target 须为 ' + TARGETS.join('/') + ' 之一')
  if (profile.priceUnit && !['yuan', 'fen'].includes(profile.priceUnit)) errors.push('priceUnit 须为 yuan（元）或 fen（分）')
  errors.push(...validateFreightTemplates(profile))
  if (profile.categories !== undefined && !Array.isArray(profile.categories)) errors.push('categories 须为数组（买家自己的分类清单）')
  if (!Number.isInteger(profile.schedule?.pollMinutes) || profile.schedule.pollMinutes < 5) errors.push('轮询间隔不得小于 5 分钟（防烧资源点）')
  if (!Number.isInteger(profile.schedule?.singleRunCap) || profile.schedule.singleRunCap < 1) errors.push('单次上限须为正整数')
  return errors
}
