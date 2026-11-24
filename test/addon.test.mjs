import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCsv, toCsv } from '../lib/csv.mjs'
import { proposeMapping, readTemplate, formatOfFile } from '../lib/template-scan.mjs'
import { validateProfile, DEFAULT_CONFIG, TARGETS, assertTarget } from '../lib/mapping-store.mjs'
import { parsePackage } from '../lib/package-parse.mjs'
import { validateProduct } from '../lib/intermediate.mjs'
import { discover, discoverCsv } from '../lib/field-discovery.mjs'
import { platformFieldMap } from '../lib/platform-fields.mjs'
import { storefrontFieldMap } from '../lib/storefront-fields.mjs'
import { resolveFreight, validateFreightTemplates, blankFreightTemplate } from '../lib/freight.mjs'
import { buildTemplateDraft, templateToProfile, validateTemplate, loadTemplateOrProfile } from '../lib/template-generator.mjs'
import { summarizeReminders, formatReminderSummary } from '../lib/report.mjs'
import * as A from '../adapters/generic-template.mjs'
import * as B from '../adapters/wander.mjs'
import * as C from '../adapters/file-only.mjs'
import * as D from '../adapters/douyin.mjs'
import * as E from '../adapters/taobao.mjs'
import * as F from '../adapters/xiaohongshu.mjs'
import * as G from '../adapters/shopify.mjs'
import * as H from '../adapters/woocommerce.mjs'
import * as I from '../adapters/youzan.mjs'
import * as J from '../adapters/shopline.mjs'
import { createFakeTarget } from '../lib/target-fake.mjs'
import { planSchedule, applySchedule, rollbackSchedule, toUtcMs, normalizeRules } from '../lib/schedule.mjs'

const OTHER_SHOP_CSV = `品名,类目,售价,库存数,主图链接,运费方式,色号,净含量,保质期,功效
玫瑰口红,美妆,59.9,100,rose-main.jpg,包邮,正红/豆沙,3.5g,36个月,滋润保湿
茉莉香水,美妆,129,50,jasmine-main.jpg,12,淡香/浓香,50ml,24个月,持久留香`

test('模板扫描：对方表头提议映射，必填无缺失', () => {
  const { headers } = readTemplate(OTHER_SHOP_CSV, 'csv')
  const p = proposeMapping(headers)
  assert.equal(p.columns.name.source, '品名')
  assert.equal(p.columns.price.source, '售价')
  assert.equal(p.columns.stock.source, '库存数')
  assert.equal(p.columns.mainImage.source, '主图链接')
  assert.deepEqual(p.missingRequired, [])
  assert.equal(p.specDims[0].source, '色号')
  assert.equal(p.extensions.netContent.source, '净含量')
  assert.equal(p.extensions.expiry.source, '保质期')
  assert.equal(p.extensions.efficacy.source, '功效')
})
test('模板扫描：缺必填列时点名缺失', () => {
  const p = proposeMapping(['品名', '售价'])
  assert.deepEqual(p.missingRequired.sort(), ['category', 'freightMode', 'mainImage', 'stock'])
  assert.equal(p.needsReview, true)
})
function confirmedProfile(target = 'generic-template') {
  const { headers } = readTemplate(OTHER_SHOP_CSV, 'csv')
  const mapping = proposeMapping(headers)
  // 模拟人工核对：全部确认
  for (const c of Object.values(mapping.columns)) if (c.source) c.status = 'auto'
  return { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), profileName: 'test', target, mapping }
}
function rowsOf(csv) {
  const parsed = parseCsv(csv)
  const headers = parsed[0]
  return parsed.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])))
}
test('素材包解析：价格元转分、规格维、扩展袋、图片角色', () => {
  const profile = confirmedProfile()
  const { products, errors, valid } = parsePackage(rowsOf(OTHER_SHOP_CSV), ['玫瑰口红_主图.jpg', '玫瑰口红_详情1.jpg', '玫瑰口红_说明图.jpg', '茉莉香水_主图.jpg'], profile)
  assert.equal(valid, true, errors.join(';'))
  assert.equal(products.length, 2)
  const lip = products[0]
  assert.equal(lip.price, 5990)
  assert.equal(lip.freightMode, 'free')
  assert.deepEqual(lip.specDims, [{ name: '色号', values: ['正红', '豆沙'] }])
  assert.equal(lip.extensions.expiry, '36个月')
  assert.equal(lip.extensions.netContent, '3.5g')
  assert.equal(lip.skus.length, 2)
  assert.equal(lip.images.find(i => i.role === 'info').file, '玫瑰口红_说明图.jpg')
  const perfume = products[1]
  assert.equal(perfume.freightMode, 'fixed')
  assert.equal(perfume.freightFixed, 1200)
  assert.equal(validateProduct(lip).errors.length, 0)
})
test('素材包解析：组合列 "红/L,蓝/M" 拆成两维', () => {
  const profile = confirmedProfile()
  const rows = rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号\n测试衫,服装,99,20,t.jpg,包邮,"红/L,蓝/M"')
  const { products, valid, errors } = parsePackage(rows, [], profile)
  assert.equal(valid, true, errors.join(';'))
  assert.equal(products[0].specDims.length, 2)
  assert.deepEqual(products[0].specDims[0].values, ['红', '蓝'])
  assert.deepEqual(products[0].specDims[1].values, ['L', 'M'])
})
test('素材包解析：缺必填报错不导入', () => {
  const profile = confirmedProfile()
  const bad = rowsOf(`品名,类目,售价,库存数,主图链接,运费方式,色号\n无价商品,美妆,,10,x.jpg,包邮,红色`)
  const { valid, errors } = parsePackage(bad, [], profile)
  assert.equal(valid, false)
  assert.ok(errors.some(e => e.includes('价格')))
})
test('适配器一致性：同一中间商品，三目标各守本分', () => {
  const profile = confirmedProfile()
  const { products } = parsePackage(rowsOf(OTHER_SHOP_CSV), [], profile)
  const p = products[0]
  const a = A.translate(p, profile)
  assert.deepEqual(a.payload.colors, ['正红', '豆沙'])
  assert.deepEqual(a.payload.sizes, [])
  assert.deepEqual(a.payload.specLabels, ['色号'])
  assert.ok(a.notes.some(n => n.includes('扩展字段')))
  const b = B.translate(p, profile)
  assert.deepEqual(b.payload.sizes, ['均码'])
  assert.deepEqual(b.payload.patterns, ['默认款'])
  assert.ok(b.notes.some(n => n.includes('填充')))
  const c = C.translate(p, profile)
  assert.equal(c.payload['规格1名'], '色号')
  assert.ok(c.payload['扩展字段'].includes('36个月'))
  const sheet = C.renderSheet(products, profile)
  assert.ok(sheet.includes('玫瑰口红') && sheet.includes('茉莉香水'))
  assert.equal(C.renameImages(products).length, 2) // 每件的主图各 1 张改名
})
test('试跑零写入证明：只解析翻译不写目标，导入后草稿可数', () => {
  const profile = confirmedProfile()
  const { products } = parsePackage(rowsOf(OTHER_SHOP_CSV), [], profile)
  const target = createFakeTarget(A.CAPABILITIES)
  products.map(p => A.translate(p, profile)) // 试跑：只翻译
  assert.equal(target.count(), 0)
  for (const p of products) target.insertDraft(A.translate(p, profile).payload)
  assert.equal(target.count(), 2)
  assert.equal(target.list()[0].stage, 'pool')
  assert.equal(target.list()[0].onShelf, false)
})
test('上下架：时区换算、门控、锁定、售罄、上限、总开关', () => {
  assert.equal(toUtcMs('2026-11-20T10:00', 'Asia/Shanghai'), Date.UTC(2026, 10, 20, 2, 0, 0))
  const products = [
    { id: 'p1', name: '甲', state: 'onShelf', onShelf: false, locked: false, stock: 5 },
    { id: 'p2', name: '乙', state: 'pool', onShelf: false, locked: false, stock: 5 },
    { id: 'p3', name: '丙', state: 'onShelf', onShelf: true, locked: true, stock: 0 },
    { id: 'p4', name: '丁', state: 'onShelf', onShelf: true, locked: false, stock: 0 },
  ]
  const now = Date.UTC(2026, 10, 20, 3, 0, 0)
  const plan = planSchedule(products, [{ productIds: ['p1', 'p2', 'p3', 'p4'], shelfAtUtcMs: Date.UTC(2026, 10, 20, 2, 0, 0), soldOutOff: true }], { masterSwitch: true, sellableStates: ['onShelf'], singleRunCap: 50 }, now)
  assert.deepEqual(plan.actions.map(a => a.id), ['p1', 'p4'])
  assert.ok(plan.skipped.some(s => s.id === 'p2'))
  assert.ok(plan.alarms.some(a => a.includes('丙')))
  const off = planSchedule(products, [{ productIds: ['p1'] }], { masterSwitch: false }, now)
  assert.equal(off.actions.length, 0)
  const capped = planSchedule(products, [{ productIds: ['p1', 'p4'], shelfAtUtcMs: 1, soldOutOff: true }], { masterSwitch: true, sellableStates: ['onShelf'], singleRunCap: 1 }, now)
  assert.equal(capped.actions.length, 0)
  assert.ok(capped.alarms.some(a => a.includes('单次上限')))
})
test('上下架回滚：执行后恢复原状', () => {
  const products = [{ id: 'p1', name: '甲', state: 'onShelf', onShelf: false, locked: false, stock: 5 }]
  const plan = planSchedule(products, [{ productIds: ['p1'], shelfAtUtcMs: 1 }], { masterSwitch: true, sellableStates: ['onShelf'], singleRunCap: 50 }, 10)
  const journal = applySchedule(products, plan)
  assert.equal(products[0].onShelf, true)
  assert.equal(rollbackSchedule(products, journal), 1)
  assert.equal(products[0].onShelf, false)
})
test('配置校验：缺映射、轮询过短、目标非法均被拒', () => {
  const bad = { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), mapping: null }
  assert.ok(validateProfile(bad).length > 0)
  const fast = confirmedProfile()
  fast.schedule.pollMinutes = 1
  assert.ok(validateProfile(fast).some(e => e.includes('轮询')))
  const wrong = confirmedProfile('pinduoduo')
  assert.ok(validateProfile(wrong).some(e => e.includes('target')))
})
test('CSV 引号与换行往返', () => {
  const rows = [['a', '含,逗号', '含"引号"'], ['b', '多\n行', '']]
  assert.deepEqual(parseCsv(toCsv(rows)), rows)
})
test('F5：非法 target 在断言层即拒绝，三平台与四家自建店为已知目标', () => {
  assert.throws(() => assertTarget('pinduoduo'), /target 须为/)
  assert.doesNotThrow(() => assertTarget('douyin'))
  assert.doesNotThrow(() => assertTarget('taobao'))
  assert.doesNotThrow(() => assertTarget('xiaohongshu'))
  assert.doesNotThrow(() => assertTarget('shopify'))
  assert.doesNotThrow(() => assertTarget('woocommerce'))
  assert.doesNotThrow(() => assertTarget('youzan'))
  assert.doesNotThrow(() => assertTarget('shopline'))
  assert.deepEqual(TARGETS, ['generic-template', 'wander', 'file-only', 'douyin', 'taobao', 'xiaohongshu', 'shopify', 'woocommerce', 'youzan', 'shopline'])
})
test('F6：scan 格式守门：xlsx 显式拒绝，csv/json 放行', () => {
  assert.throws(() => formatOfFile('样表.xlsx'), /不支持 Excel/)
  assert.throws(() => formatOfFile('样表.xls'), /不支持 Excel/)
  assert.equal(formatOfFile('样表.csv'), 'csv')
  assert.equal(formatOfFile('样表.json'), 'json')
  assert.throws(() => formatOfFile('样表.txt'), /只认/)
})
test('F1：提醒统一计数：解析＋适配分开计、总数一致', () => {
  const s = summarizeReminders(['a', 'b'], ['c'])
  assert.deepEqual(s, { parse: 2, adapter: 1, total: 3 })
  assert.equal(formatReminderSummary(s), '提醒共 3 条（解析提醒 2 条，适配提醒 1 条）')
  assert.deepEqual(summarizeReminders([], []), { parse: 0, adapter: 0, total: 0 })
})
test('G-03：规格超 3 维时解析报错，不静默截断', () => {
  const { headers } = readTemplate(OTHER_SHOP_CSV, 'csv')
  const mapping = proposeMapping(headers)
  assert.equal(mapping.specDimsOverflow, false)
  const p4 = proposeMapping(['品名', '颜色', '尺码', '容量', '口味'])
  assert.equal(p4.specDimsOverflow, true)
  assert.equal(p4.specDims.length, 4)
  const profile = confirmedProfile()
  profile.mapping.specDims = [{ name: '颜色', source: '色号' }, { name: '尺码', source: '色号' }, { name: '容量', source: '色号' }, { name: '口味', source: '色号' }]
  const { valid, errors } = parsePackage(rowsOf(OTHER_SHOP_CSV), [], profile)
  assert.equal(valid, false)
  assert.ok(errors.some(e => e.includes('超过 3 维')))
})
test('G-05：价格单位由配置定死：fen 不再把 100000 分猜成元', () => {
  const profile = confirmedProfile()
  profile.priceUnit = 'fen'
  const rows = rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号\n高价货,美妆,100000,5,x.jpg,包邮,红色')
  const { products, valid, errors } = parsePackage(rows, [], profile)
  assert.equal(valid, true, errors.join(';'))
  assert.equal(products[0].price, 100000)
  const yuan = confirmedProfile()
  yuan.priceUnit = 'yuan'
  const { products: p2 } = parsePackage(rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号\n平价货,美妆,59.9,5,x.jpg,包邮,红色'), [], yuan)
  assert.equal(p2[0].price, 5990)
})
test('G-04：未知运费值出警告，不再无声兜底成模板名', () => {
  const profile = confirmedProfile()
  const { products, warnings, valid } = parsePackage(rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号\n测试货,美妆,10,5,x.jpg,到付,红色'), [], profile)
  assert.equal(valid, true)
  assert.equal(products[0].freightMode, 'template')
  assert.ok(warnings.some(w => w.includes('到付')))
})
test('G-01：未映射列在解析报告里点名，值未导入不再静默', () => {
  const profile = confirmedProfile()
  const rows = rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号,SC编号\n测试货,美妆,10,5,x.jpg,包邮,红色,SC123')
  const { warnings, valid } = parsePackage(rows, [], profile)
  assert.equal(valid, true)
  assert.ok(warnings.some(w => w.includes('未映射列') && w.includes('SC编号')))
})
test('G-10：主图同名文件只保留一条，不重复出现', () => {
  const profile = confirmedProfile()
  const rows = rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号\n玫瑰口红,美妆,59.9,100,rose-main.jpg,包邮,正红')
  const { products } = parsePackage(rows, ['rose-main.jpg', '玫瑰口红_详情1.jpg'], profile)
  const mains = products[0].images.filter(i => i.file === 'rose-main.jpg')
  assert.equal(mains.length, 1)
  assert.equal(C.renameImages(products).filter(r => r.from === 'rose-main.jpg').length, 1)
})
test('可读时间规则：shelfAt 与 epoch 写法换算一致，格式错时抛错', () => {
  const n = normalizeRules([{ productIds: ['p1'], shelfAt: '2026-11-14T13:20', soldOutOff: true }], 'Asia/Shanghai')
  assert.equal(n[0].shelfAtUtcMs, 1794633600000)
  const old = normalizeRules([{ productIds: ['p1'], shelfAtUtcMs: 1794633600000 }], 'Asia/Shanghai')
  assert.equal(old[0].shelfAtUtcMs, 1794633600000)
  assert.throws(() => normalizeRules([{ shelfAt: '2026/11/14 13:20' }], 'Asia/Shanghai'), /时间格式不对/)
})
test('字段发现：数据库字段列表与 API schema 都能提议映射，目标必填未映射报警', () => {
  const db = discover({ table: 'products', fields: [
    { name: 'product_name', type: 'text', required: true },
    { name: 'price_cents', type: 'bigint', required: true },
    { name: 'sc_license', type: 'text', required: true },
  ] }, 'db')
  assert.equal(db.proposal.columns.name.source, 'product_name')
  assert.equal(db.proposal.columns.price.source, 'price_cents') // 包含匹配，review 档
  assert.equal(db.proposal.columns.price.status, 'review')
  assert.deepEqual(db.targetRequiredUnmapped, ['sc_license'])
  const api = discover({ properties: { title: { type: 'string' }, stock: { type: 'integer' } } }, 'api')
  assert.equal(api.proposal.columns.name.source, 'title')
  assert.equal(api.proposal.columns.stock.source, 'stock')
})
test('字段发现 CSV：疑似规格维（枚举状未命中列）列为候选', () => {
  const csv = '品名,类目,售价,库存数,主图链接,运费方式,适用人群\n测试货,美妆,10,5,x.jpg,包邮,成人\n测试货2,美妆,12,5,y.jpg,包邮,儿童'
  const r = discoverCsv(csv, 'csv')
  assert.ok(r.suspectedSpecDims.some(d => d.name === '适用人群'))
  assert.deepEqual(r.suspectedSpecDims.find(d => d.name === '适用人群').values, ['成人', '儿童'])
})
test('三平台适配器：字段映射先行、写入口抛错不假成功', () => {
  const profile = confirmedProfile()
  const { products } = parsePackage(rowsOf(OTHER_SHOP_CSV), [], profile)
  const p = products[0]
  for (const [adapter, titleKey] of [[D, '商品标题'], [E, '宝贝标题'], [F, '商品标题']]) {
    assert.equal(adapter.CAPABILITIES.implemented, false)
    const t = adapter.translate(p, profile)
    assert.equal(t.payload[titleKey], '玫瑰口红')
    assert.ok(Array.isArray(t.missingRequired))
    assert.throws(() => adapter.createDraft({}), /平台接口未接通/)
    assert.throws(() => adapter.setShelf('x', true), /平台接口未接通/)
  }
  const douyin = platformFieldMap('douyin')
  assert.ok(douyin.requiredFields.includes('商品标题'))
  assert.deepEqual(douyin.statusNames, ['售卖中', '已下架', '审核中', '审核不通过', '封禁']) // 第二轮：已按抖店公开资料核实，不再是 null
  assert.equal(douyin.specMaxDims, 3) // TikTok Shop API：销售属性最多 3 类
  assert.equal(douyin.skuMax, 300)
  assert.deepEqual(platformFieldMap('taobao').statusNames, ['出售中', '仓库中'])
  assert.ok(platformFieldMap('xiaohongshu').categoryFields.食品.includes('SC生产许可证编号'))
  assert.deepEqual(platformFieldMap('xiaohongshu').statusNames, ['售卖中', '已下架', '待审核', '审核中', '审核不通过'])
  assert.equal(platformFieldMap('xiaohongshu').specMaxDims, null) // 未查到公开资料，仍标待实测
  assert.equal(platformFieldMap('taobao').imageRules.mainMin, 5)
})

// ---- 第二轮新增测试（运费模板口径 / 三平台完整化 / 自建店适配器 / 自生成模板 / 接口口子） ----
test('R2-运费：包邮/固定/模板三种映射结果写清，登记表命中出计费与区域价', () => {
  const tpl = blankFreightTemplate('江浙沪包邮模板')
  tpl.regions = [{ region: '江浙沪', firstUnit: 1, firstFeeCents: 600, additionalUnit: 1, additionalFeeCents: 100 }]
  tpl.freeThresholdCents = 9900
  const profile = { freightTemplates: [tpl], freightTemplateDefault: '' }
  assert.equal(resolveFreight({ name: '甲', freightMode: 'free' }, profile).summary, '包邮')
  assert.equal(resolveFreight({ name: '乙', freightMode: 'fixed', freightFixed: 1200 }, profile).summary, '固定运费 ¥12.00')
  const r = resolveFreight({ name: '丙', freightMode: 'template', freightTemplate: '江浙沪包邮模板' }, profile)
  assert.equal(r.error, '')
  assert.ok(r.summary.includes('江浙沪包邮模板') && r.summary.includes('按件') && r.summary.includes('¥6.00') && r.summary.includes('满 ¥99.00 包邮'))
})
test('R2-运费：模板方式缺模板名即报错，提示先设模板，不编默认值', () => {
  const r = resolveFreight({ name: '丁', freightMode: 'template', freightTemplate: '' }, { freightTemplates: [], freightTemplateDefault: '' })
  assert.ok(r.error.includes('未指定运费模板名') && r.error.includes('先在买家后台建好运费模板'))
  // 买家明确指定了默认模板时可用（不是静默默认值）
  const r2 = resolveFreight({ name: '丁', freightMode: 'template', freightTemplate: '' }, { freightTemplates: [blankFreightTemplate('默认运费模板')], freightTemplateDefault: '默认运费模板' })
  assert.equal(r2.error, '')
  assert.equal(r2.templateName, '默认运费模板')
})
test('R2-运费：登记表里查无此名只警告不阻断；登记表校验拦住坏模板', () => {
  const profile = { freightTemplates: [blankFreightTemplate('A模板')], freightTemplateDefault: '' }
  const r = resolveFreight({ name: '戊', freightMode: 'template', freightTemplate: 'B模板' }, profile)
  assert.equal(r.error, '')
  assert.ok(r.warning.includes('B模板') && r.warning.includes('不在配置登记'))
  assert.ok(validateFreightTemplates({ freightTemplates: [{ name: 'X', chargeType: '按斤', regions: [] }] }).length > 0)
  assert.ok(validateFreightTemplates({ freightTemplates: [blankFreightTemplate('A'), blankFreightTemplate('A')] }).some(e => e.includes('重复')))
  assert.ok(validateFreightTemplates({ freightTemplates: [blankFreightTemplate('A')], freightTemplateDefault: 'B' }).some(e => e.includes('不在')))
  assert.deepEqual(validateFreightTemplates({ freightTemplates: [blankFreightTemplate('A')] }), [])
})
test('R2-运费：运费格为空解析即报错；运费映射数组随解析返回', () => {
  const profile = confirmedProfile()
  const { valid, errors, freight } = parsePackage(rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号\n空运费货,美妆,10,5,x.jpg,,红色'), [], profile)
  assert.equal(valid, false)
  assert.ok(errors.some(e => e.includes('运费方式未填')))
  assert.equal(freight[0].summary, '运费模板未定（运费格为空）')
  const ok = parsePackage(rowsOf(OTHER_SHOP_CSV), [], profile)
  assert.equal(ok.valid, true)
  assert.equal(ok.freight[0].summary, '包邮')
  assert.equal(ok.freight[1].summary, '固定运费 ¥12.00')
})
test('R2-模板生成：样表生成草稿，映射/分类/规格值一次抽全', () => {
  const draft = buildTemplateDraft({ fields: ['品名', '类目', '售价', '库存数', '主图链接', '运费方式', '色号', '净含量', '保质期', '功效'], rows: [['玫瑰口红', '美妆', '59.9', '100', 'rose-main.jpg', '包邮', '正红', '3.5g', '36个月', '滋润'], ['茉莉香水', '美妆', '129', '50', 'jasmine-main.jpg', '12', '淡香', '50ml', '24个月', '持久']], headers: ['品名', '类目', '售价', '库存数', '主图链接', '运费方式', '色号', '净含量', '保质期', '功效'], sourceKind: 'sample', sourceLabel: '样表.csv', name: '我的美妆模板', target: 'douyin' })
  assert.equal(draft.templateFormat, 1)
  assert.equal(draft.target, 'douyin')
  assert.equal(draft.fields.find(f => f.targetField === 'name').sourceColumn, '品名')
  assert.equal(draft.fields.find(f => f.targetField === 'price').sourceColumn, '售价')
  assert.deepEqual(draft.categories, ['美妆'])
  assert.deepEqual(draft.specDims[0], { name: '色号', values: ['正红', '淡香'] })
  assert.equal(draft.freightTemplates[0].name, '默认运费模板')
  assert.equal(draft.freightTemplateDefault, '')
  assert.deepEqual(validateTemplate(draft), [])
})
test('R2-模板生成：字段清单无行数据也能生成；模板转配置后校验通过；缺必填来源被拒', () => {
  const draft = buildTemplateDraft({ fields: ['商品名', '分类', '价格', '库存', '主图', '运费方式'], sourceKind: 'fields', name: '空表模板', target: 'generic-template' })
  assert.deepEqual(draft.categories, [])
  assert.deepEqual(validateTemplate(draft), [])
  const profile = templateToProfile(draft, '空表店')
  assert.equal(profile.target, 'generic-template')
  assert.deepEqual(validateProfile(profile), [])
  assert.equal(profile.mapping.columns.name.source, '商品名')
  const bad = JSON.parse(JSON.stringify(draft))
  bad.fields.find(f => f.targetField === 'price').sourceColumn = ''
  assert.ok(validateTemplate(bad).some(e => e.includes('价格')))
  const dup = JSON.parse(JSON.stringify(draft))
  dup.fields.find(f => f.targetField === 'stock').sourceColumn = '商品名'
  assert.ok(validateTemplate(dup).some(e => e.includes('来源列重复')))
})
test('R2-三平台完整化：状态名、上架态、规格上限、必填缺失（品牌/运费模板）', () => {
  assert.deepEqual(D.SHELF, { onShelf: '售卖中', offShelf: '已下架', sellableStates: ['售卖中'], auditStates: ['审核中', '审核不通过'], bannedStates: ['封禁'] })
  assert.deepEqual(E.SHELF.sellableStates, ['出售中'])
  assert.deepEqual(F.SHELF.sellableStates, ['售卖中'])
  assert.ok(D.REQUIRED_ONBOARDING.some(x => x.item === '入驻主体'))
  assert.ok(F.REQUIRED_ONBOARDING.some(x => x.item === '品牌授权'))
  const profile = confirmedProfile()
  const { products } = parsePackage(rowsOf(OTHER_SHOP_CSV), [], profile)
  const p = products[0] // 玫瑰口红：无品牌列
  assert.ok(D.translate(p, profile).missingRequired.includes('品牌（无品牌请填“无品牌”；品牌商品须授权）'))
  assert.ok(E.translate(p, profile).missingRequired.includes('品牌（无品牌请选“无品牌”，避免降权与知识产权纠纷）'))
  const noFreight = { ...p, freightMode: 'template', freightTemplate: '' }
  assert.ok(D.translate(noFreight, profile).missingRequired.includes('运费模板'))
  assert.ok(D.translate(p, profile).notes.some(n => n.includes('主图 1 张，少于抖店最少要求 5 张')))
})
test('R2-自建店适配器：Shopify/WooCommerce/有赞/SHOPLINE 翻译各守本分', () => {
  const profile = confirmedProfile()
  const { products } = parsePackage(rowsOf(OTHER_SHOP_CSV), [], profile)
  const p = products[0]
  const g = G.translate(p, profile)
  assert.equal(g.payload.rows[0].Title, '玫瑰口红')
  assert.equal(g.payload.rows[0].Published, 'FALSE') // 只到草稿
  assert.equal(g.payload.rows[0]['Option1 Name'], '色号')
  assert.equal(g.payload.rows.length, 2)
  assert.ok(g.notes.some(n => n.includes('Shopify 商品无运费模板字段')))
  const h = H.translate(p, profile)
  assert.equal(h.payload.Type, 'variable')
  assert.equal(h.payload.Published, 0)
  assert.equal(h.payload['Attribute 1 name'], '色号')
  const i = I.translate(p, profile)
  assert.equal(i.payload.商品名称, '玫瑰口红')
  assert.equal(i.payload.状态, '商品库') // 只到商品库，不发布不上架
  assert.equal(i.payload.物流信息.运费方式, 'free')
  const j = J.translate(p, profile)
  assert.equal(j.payload.rows[0].Status, 'Deactivated')
  assert.equal(j.payload.rows[0].Visibility, 'Hidden')
  assert.ok(j.notes.some(n => n.includes('Package 信息不支持商品 CSV')))
  for (const [adapter, label] of [[G, 'Shopify'], [H, 'WooCommerce'], [I, '有赞微商城'], [J, 'SHOPLINE']]) {
    assert.equal(adapter.CAPABILITIES.implemented, false)
    assert.throws(() => adapter.createDraft({}), /接口未接通/)
    assert.ok(Array.isArray(adapter.REQUIRED_ONBOARDING) && adapter.REQUIRED_ONBOARDING.length >= 3, label)
  }
})
test('R2-自建店字段表：状态名与必填项齐全；微盟未进白名单', () => {
  assert.deepEqual(storefrontFieldMap('shopify').statusNames, ['active', 'draft', 'archived'])
  assert.deepEqual(storefrontFieldMap('woocommerce').statusNames, ['publish', 'draft', 'private'])
  assert.deepEqual(storefrontFieldMap('youzan').statusNames, ['商品库', '已发布', '已上架', '已下架'])
  assert.deepEqual(storefrontFieldMap('shopline').statusNames, ['Activated', 'Deactivated'])
  assert.equal(storefrontFieldMap('shopline').specMaxDims, 5) // 平台支持 5 维，引擎仍限 3 维
  assert.ok(storefrontFieldMap('shopify').requiredFields.some(f => f.includes('Title')))
  assert.throws(() => storefrontFieldMap('weimob'), /未知自建店平台/)
  assert.throws(() => assertTarget('weimob'), /target 须为/)
})
test('R2-接口口子：connect 缺凭据即报错点名；配齐后方法仍抛未接通、方法名不变', () => {
  assert.throws(() => D.connect({}), /缺少连接配置 appKey/)
  assert.throws(() => D.connect({ appKey: 'x', appSecret: 'y' }), /缺少连接配置 accessToken/)
  const client = D.connect({ appKey: 'x', appSecret: 'y', accessToken: 'z', shopId: 's1' })
  assert.equal(client.connected, false)
  assert.deepEqual(client.methods, ['createProduct', 'getProduct', 'setShelf', 'listProducts'])
  assert.throws(() => client.createProduct({}), /接口未接通.*createProduct/)
  assert.throws(() => client.setShelf('1', true), /接口未接通.*setShelf/)
  const shop = G.connect({ shop: 'x.myshopify.com', accessToken: 't' })
  assert.throws(() => shop.getProduct('1'), /接口未接通.*getProduct/)
})
test('R2-通用模板运费：模板方式写清映射，固定运费注明落点待写库层定', () => {
  const profile = confirmedProfile()
  profile.freightTemplates = [{ name: '江浙沪模板', chargeType: '按件', regions: [{ region: '江浙沪', firstUnit: 1, firstFeeCents: 600, additionalUnit: 1, additionalFeeCents: 100 }], freeThresholdCents: null, note: '' }]
  const { products } = parsePackage(rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号\n模板货,美妆,10,5,x.jpg,江浙沪模板,红色'), [], profile)
  const a = A.translate(products[0], profile)
  assert.equal(a.payload.freightTemplateName, '江浙沪模板')
  assert.ok(a.notes.some(n => n.includes('江浙沪模板') && n.includes('¥6.00')))
  const { products: fixed } = parsePackage(rowsOf(OTHER_SHOP_CSV), [], confirmedProfile())
  const b = A.translate(fixed[1], confirmedProfile())
  assert.ok(b.notes.some(n => n.includes('固定运费') && n.includes('不由工具编固定模板')))
})
test('R2-品牌扩展：品牌列进扩展袋，抖音/淘宝翻译带品牌', () => {
  const profile = confirmedProfile()
  profile.mapping.extensions.brand = { source: '品牌', status: 'auto' } // 模拟人工核对：把品牌列补进扩展映射
  const { products } = parsePackage(rowsOf('品名,类目,售价,库存数,主图链接,运费方式,色号,品牌\n大牌口红,美妆,59.9,100,rose-main.jpg,包邮,正红,花西子'), [], profile)
  assert.equal(products[0].extensions.brand, '花西子')
  assert.equal(D.translate(products[0], profile).payload.品牌, '花西子')
  assert.ok(!D.translate(products[0], profile).missingRequired.some(m => m.startsWith('品牌')))
})
test('R2-模板生成：品牌列经模板转配置不丢失（回归：扩展清单须含 brand）', () => {
  const draft = buildTemplateDraft({ fields: ['品名', '类目', '售价', '库存数', '主图链接', '运费方式', '品牌'], sourceKind: 'fields', name: '品牌模板', target: 'douyin' })
  assert.equal(draft.fields.find(f => f.targetField === 'brand').label, '品牌')
  assert.equal(draft.fields.find(f => f.targetField === 'brand').sourceColumn, '品牌')
  const profile = templateToProfile(draft, '品牌店')
  assert.equal(profile.mapping.extensions.brand.source, '品牌')
  assert.deepEqual(validateProfile(profile), [])
})
test('R2-模板与配置双格式：loadTemplateOrProfile 草稿与映射配置都认', () => {
  const dir = mkdtempSync(join(tmpdir(), 'addon-r2-'))
  const draft = buildTemplateDraft({ fields: ['品名', '类目', '售价', '库存数', '主图链接', '运费方式'], sourceKind: 'fields', name: '双格式模板', target: 'douyin' })
  const draftPath = join(dir, 'draft.json')
  writeFileSync(draftPath, JSON.stringify(draft, null, 2))
  const loadedDraft = loadTemplateOrProfile(draftPath)
  assert.equal(loadedDraft.kind, 'template')
  assert.equal(loadedDraft.draft.templateName, '双格式模板')
  const profile = templateToProfile(draft, '双格式店')
  const profilePath = join(dir, 'profile.json')
  writeFileSync(profilePath, JSON.stringify(profile, null, 2))
  const loadedProfile = loadTemplateOrProfile(profilePath)
  assert.equal(loadedProfile.kind, 'profile')
  assert.equal(loadedProfile.profile.profileName, '双格式店')
  assert.equal(loadedProfile.profile.target, 'douyin')
  const badPath = join(dir, 'bad.json')
  writeFileSync(badPath, JSON.stringify({ foo: 1 }))
  assert.throws(() => loadTemplateOrProfile(badPath), /既不是模板草稿/)
})
