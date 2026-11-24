// 上下架引擎：批量设定 + 试跑 + 回滚 + 锁定 + 单次上限 + 总开关。
// 时间一律存 UTC，显示按配置时区换算，不依赖浏览器时区（复用 B-32 脱钩写法）。
export function toUtcMs(localIso, timezone) {
  // localIso 如 2026-11-20T10:00（配置时区的墙上时间）→ UTC 毫秒。无依赖实现：用 Intl 反推偏移。
  const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) throw new Error('时间格式须为 YYYY-MM-DDTHH:mm')
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]))
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return guess + (guess - asUtc)
}
export function formatInTz(utcMs, timezone) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(utcMs))
}
// rule: {productIds:[], shelfAtUtcMs|null, unshelfAtUtcMs|null, soldOutOff:bool}
// product: {id, name, state, onShelf, locked, stock}
// sellableStates: 处于这些状态才允许动（如 ['onShelf'] 状态名可配；此处 state 取商品的 stage+review 组合名，由适配器传入）
// 规则时间归一化：规则文件可用可读写法 shelfAt/unshelfAt（配置时区的墙上时间
// YYYY-MM-DDTHH:mm），也可沿用旧的 shelfAtUtcMs/unshelfAtUtcMs（epoch 毫秒）。
// 可读写法优先；两种都不写即无定时触发。时间格式不对时抛错，不静默跳过。
export function normalizeRules(rules, timezone) {
  return (rules || []).map((r, i) => {
    const out = { ...r }
    for (const [readable, ms] of [['shelfAt', 'shelfAtUtcMs'], ['unshelfAt', 'unshelfAtUtcMs']]) {
      if (r[readable] !== undefined && r[readable] !== null && r[readable] !== '') {
        try { out[ms] = toUtcMs(r[readable], timezone) } catch (e) { throw new Error(`规则 ${i + 1} 的 ${readable} 时间格式不对：${r[readable]}（须为 YYYY-MM-DDTHH:mm）`) }
      }
    }
    return out
  })
}
export function planSchedule(products, rules, config, nowMs) {
  const actions = [], skipped = [], alarms = []
  if (config?.masterSwitch === false) return { actions, skipped, alarms: ['总开关已关闭：本次不产生任何动作'] }
  const sellable = new Set(config?.sellableStates || ['onShelf'])
  const byId = new Map(products.map(p => [p.id, p]))
  for (const rule of rules) {
    for (const pid of rule.productIds || []) {
      const p = byId.get(pid)
      if (!p) { skipped.push({ id: pid, reason: '目标中无此商品' }); continue }
      if (p.locked) { alarms.push(`商品 ${p.name}（${pid}）已锁定：跳过并报警`); skipped.push({ id: pid, reason: '已锁定' }); continue }
      if (!sellable.has(p.state)) { skipped.push({ id: pid, reason: `未达可售状态（当前 ${p.state}）` }); continue }
      if (rule.shelfAtUtcMs && rule.shelfAtUtcMs <= nowMs && !p.onShelf) actions.push({ id: pid, name: p.name, action: 'shelf', atUtcMs: rule.shelfAtUtcMs })
      if (rule.unshelfAtUtcMs && rule.unshelfAtUtcMs <= nowMs && p.onShelf) actions.push({ id: pid, name: p.name, action: 'unshelf', atUtcMs: rule.unshelfAtUtcMs })
      if (rule.soldOutOff && p.stock <= 0 && p.onShelf) actions.push({ id: pid, name: p.name, action: 'unshelf', atUtcMs: nowMs, reason: '售罄自动下架' })
    }
  }
  const cap = config?.singleRunCap ?? 50
  if (actions.length > cap) {
    alarms.push(`本轮动作 ${actions.length} 个超过单次上限 ${cap}：全部停下报警，不执行其中任何一个`)
    return { actions: [], skipped: [...skipped, ...actions.map(a => ({ id: a.id, reason: '超单次上限，整轮停下' }))], alarms }
  }
  return { actions, skipped, alarms }
}
// apply 返回 journal（回滚凭证）；rollback(journal) 恢复执行前状态。journal 追加式，不覆盖。
export function applySchedule(products, plan) {
  const journal = { at: new Date().toISOString(), entries: [] }
  const byId = new Map(products.map(p => [p.id, p]))
  for (const a of plan.actions) {
    const p = byId.get(a.id)
    if (!p) continue
    journal.entries.push({ id: a.id, before: p.onShelf, after: a.action === 'shelf' })
    p.onShelf = a.action === 'shelf'
  }
  return journal
}
export function rollbackSchedule(products, journal) {
  const byId = new Map(products.map(p => [p.id, p]))
  for (const e of journal.entries) {
    const p = byId.get(e.id)
    if (p) p.onShelf = e.before
  }
  return journal.entries.length
}
