// 运费模板（第二轮，Sam 2026-11-19 23:34 亲定新口径）：
// 运费模板由买家自己在后台设置好，工具只往里填，不由工具编一个固定模板让买家照着填。
// profile.freightTemplates 是买家已建模板的登记表（模板名、计费方式、区域与价格结构可配）；
// freightTemplateDefault 是买家明确指定的默认模板名（空 = 不设默认，不静默编默认值）。
// 解析规则：
// - free / fixed 照旧；template 须有模板名（清单运费列或 freightTemplateDefault），缺名即报错，
//   提示买家先去后台建模板再填名，不静默用默认值；
// - 模板名在登记表里找到 → 映射结果写清计费方式与区域价格；登记表非空但名不在表里 → 警告（仍按名传递，写库时按名查找）；
// - 登记表为空时只按名传递，并注明“未登记”。
export const FREIGHT_CHARGE_TYPES = ['按件', '按重量', '按金额']
export function blankFreightTemplate(name = '默认运费模板') {
  return {
    name,
    chargeType: '按件',
    regions: [{ region: '全国（默认）', firstUnit: 1, firstFeeCents: 800, additionalUnit: 1, additionalFeeCents: 200 }],
    freeThresholdCents: null, // 满多少（分）包邮；null = 不设满包邮
    note: '改成你后台已建好的模板名与价格；工具只往里填，不另编模板',
  }
}
export function formatCents(cents) {
  return '¥' + (Number(cents || 0) / 100).toFixed(2)
}
export function describeFreightTemplate(t) {
  const regions = (t.regions || []).map(r =>
    `${r.region}：首 ${r.firstUnit}${t.chargeType === '按重量' ? 'kg' : '件'} ${formatCents(r.firstFeeCents)}，续 ${r.additionalUnit}${t.chargeType === '按重量' ? 'kg' : '件'} ${formatCents(r.additionalFeeCents)}`).join('；')
  const free = t.freeThresholdCents ? `；满 ${formatCents(t.freeThresholdCents)} 包邮` : ''
  return `计费：${t.chargeType}；${regions}${free}`
}
// 校验买家登记的运费模板表。返回错误数组（空 = 通过）。
export function validateFreightTemplates(profile) {
  const errors = []
  const list = profile.freightTemplates
  if (list === undefined || list === null) return errors // 老配置无此项：不强制，缺模板时在 resolveFreight 里按件报错
  if (!Array.isArray(list)) return ['freightTemplates 须为数组（每项为一个运费模板）']
  const names = new Set()
  list.forEach((t, i) => {
    const tag = `运费模板第 ${i + 1} 个`
    if (!t || typeof t.name !== 'string' || !t.name.trim()) { errors.push(`${tag}缺少模板名`); return }
    if (names.has(t.name)) errors.push(`运费模板名重复：${t.name}`)
    names.add(t.name)
    if (!FREIGHT_CHARGE_TYPES.includes(t.chargeType)) errors.push(`运费模板「${t.name}」计费方式须为 按件/按重量/按金额 之一`)
    if (!Array.isArray(t.regions) || !t.regions.length) { errors.push(`运费模板「${t.name}」至少须填一个区域与价格`); return }
    t.regions.forEach((r, j) => {
      if (!r.region) errors.push(`运费模板「${t.name}」第 ${j + 1} 个区域缺少区域名`)
      for (const k of ['firstUnit', 'firstFeeCents', 'additionalUnit', 'additionalFeeCents']) {
        if (!Number.isSafeInteger(r[k]) || r[k] < 0) errors.push(`运费模板「${t.name}」区域「${r.region || '?'}」的 ${k} 须为非负整数`)
      }
      if (!Number.isSafeInteger(r.firstUnit) || r.firstUnit < 1) errors.push(`运费模板「${t.name}」区域「${r.region || '?'}」的首件/首重数量至少为 1`)
    })
    if (t.freeThresholdCents !== null && t.freeThresholdCents !== undefined && (!Number.isSafeInteger(t.freeThresholdCents) || t.freeThresholdCents < 0)) {
      errors.push(`运费模板「${t.name}」的满包邮门槛须为非负整数（分）或留空`)
    }
  })
  if (profile.freightTemplateDefault) {
    if (!list.length) errors.push('freightTemplateDefault 已填默认模板名，但 freightTemplates 登记表为空：请先登记模板')
    else if (!names.has(profile.freightTemplateDefault)) errors.push(`默认运费模板「${profile.freightTemplateDefault}」不在 freightTemplates 登记表里`)
  }
  return errors
}
// 把一件中间格式商品的运费解析成映射结果。缺模板名时 error 非空（调用方须阻断导入）。
export function resolveFreight(product, profile = {}) {
  const name = product.name || '未命名'
  if (product.freightMode === 'free') return { mode: 'free', templateName: '', template: null, fixedCents: 0, summary: '包邮', error: '', warning: '' }
  if (product.freightMode === 'fixed') {
    return { mode: 'fixed', templateName: '', template: null, fixedCents: product.freightFixed || 0, summary: `固定运费 ${formatCents(product.freightFixed || 0)}`, error: '', warning: '' }
  }
  // template：模板名来自清单运费列，其次是买家明确指定的默认模板；两者都没有即报错，不编默认值
  const templateName = (product.freightTemplate || '').trim() || (profile.freightTemplateDefault || '').trim()
  if (!templateName) {
    return { mode: 'template', templateName: '', template: null, fixedCents: 0, summary: '运费模板未定', error: `商品「${name}」运费方式为模板，但未指定运费模板名：请先在买家后台建好运费模板，再在清单运费列或配置 freightTemplateDefault 里填入模板名（工具不自动编默认值）`, warning: '' }
  }
  const registry = Array.isArray(profile.freightTemplates) ? profile.freightTemplates : []
  const found = registry.find(t => t.name === templateName)
  if (found) return { mode: 'template', templateName, template: found, fixedCents: 0, summary: `运费模板「${templateName}」（${describeFreightTemplate(found)}）`, error: '', warning: '' }
  if (registry.length) {
    return { mode: 'template', templateName, template: null, fixedCents: 0, summary: `运费模板「${templateName}」（未在配置登记，仅按名传递）`, error: '', warning: `商品「${name}」的运费模板「${templateName}」不在配置登记的模板清单里（已登记：${registry.map(t => t.name).join('、')}），请核对买家后台是否已建该模板；写库时按名查找，查无会失败` }
  }
  return { mode: 'template', templateName, template: null, fixedCents: 0, summary: `运费模板「${templateName}」（未登记，仅按名传递；写库时按名查找）`, error: '', warning: '' }
}
