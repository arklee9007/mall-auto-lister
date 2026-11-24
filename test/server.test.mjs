// 界面版服务器测试：起一个临时端口的服务器，调接口、用演示数据断言 dry-run 的数字。
// 配置写进临时目录（ADDON_PROFILES_DIR），不污染正式 profiles/。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILES_TMP = mkdtempSync(join(tmpdir(), 'addon-ui-test-'))
process.env.ADDON_PROFILES_DIR = PROFILES_TMP
const { createServer } = await import('../bin/server.mjs')

const LIST_CSV = readFileSync(join(ROOT, 'sam-test', 'material-pack', '清单.csv'), 'utf-8')
const SAMPLE_CSV = readFileSync(join(ROOT, 'sam-test', 'other-shop', '对方商城样表.csv'), 'utf-8')
const STATUS = JSON.parse(readFileSync(join(ROOT, 'sam-test', '上下架状态.json'), 'utf-8'))
const RULES_READABLE = JSON.parse(readFileSync(join(ROOT, 'sam-test', '上下架规则-可读时间.json'), 'utf-8'))
const IMAGE_NAMES = ['纯棉T恤_主图.svg', '纯棉T恤_详情1.svg', '帆布手提袋_主图.svg', '手工香皂_主图.svg', '手工香皂_说明图.svg']

let base
const server = createServer()
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
test.after(() => new Promise(resolve => server.close(resolve)))
async function call(path, method, body) {
  const r = await fetch(base + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json(), text: null }
}
async function callText(path) {
  const r = await fetch(base + path)
  return { status: r.status, text: await r.text() }
}

test('首页：返回界面 HTML，含版本号与边界实话', async () => {
  const { status, text } = await callText('/')
  assert.equal(status, 200)
  assert.match(text, /自动化插件 · 界面版/)
  assert.match(text, /v1\.3\.0/)
  assert.match(text, /零写入/)
})

test('演示数据：GET /api/demo 返回四份演示内容', async () => {
  const { json } = await call('/api/demo')
  assert.equal(json.ok, true)
  assert.match(json.listCsv, /纯棉T恤/)
  assert.match(json.sampleCsv, /产品名称/)
  assert.equal(json.statusJson.length, 3)
  assert.equal(json.rulesReadableJson.length, 1)
  assert.equal(json.imageNames.length, 5)
})

test('扫样表：POST /api/scan 提议映射与 CLI 一致', async () => {
  const { json } = await call('/api/scan', 'POST', { filename: '对方商城样表.csv', content: SAMPLE_CSV })
  assert.equal(json.ok, true)
  assert.equal(json.proposal.columns.name.source, '产品名称')
  assert.equal(json.proposal.columns.price.source, '单价')
  assert.deepEqual(json.proposal.missingRequired, [])
})

test('建配置：POST /api/profiles 扫样表建测试店', async () => {
  const { json } = await call('/api/profiles', 'POST', { mode: 'scan', name: '测试店', target: 'generic-template', filename: '对方商城样表.csv', content: SAMPLE_CSV })
  assert.equal(json.ok, true)
  assert.equal(json.profile.profileName, '测试店')
  assert.deepEqual(json.missingRequired, [])
  const list = await call('/api/profiles')
  assert.equal(list.json.profiles.length, 1)
  assert.equal(list.json.profiles[0].name, '测试店')
})

test('试跑：演示数据 dry-run 与 CLI 一致（3 件、0 错误、4 提醒、运费三条）', async () => {
  const { json } = await call('/api/dry-run', 'POST', { profile: '测试店', listFilename: '清单.csv', listContent: LIST_CSV, imageNames: IMAGE_NAMES })
  assert.equal(json.ok, true)
  assert.equal(json.productCount, 3)
  assert.equal(json.errorCount, 0)
  assert.equal(json.reminderSummary.total, 4)
  assert.equal(json.reminderSummary.parse, 0)
  assert.equal(json.reminderSummary.adapter, 4)
  assert.deepEqual(json.freight.map(f => f.summary), ['包邮', '固定运费 ¥8.00', '包邮'])
  assert.equal(json.valid, true)
  assert.match(json.conclusion, /零写入/)
  assert.equal(json.firstPayload.name, '纯棉T恤')
  assert.deepEqual(json.firstPayload.colors, ['白', '黑'])
  assert.deepEqual(json.firstPayload.sizes, ['M', 'L'])
})

test('模拟导入：通用模板目标出草稿 0 → 3 件', async () => {
  const { json } = await call('/api/import-fake', 'POST', { profile: '测试店', listFilename: '清单.csv', listContent: LIST_CSV, imageNames: IMAGE_NAMES })
  assert.equal(json.ok, true)
  assert.equal(json.before, 0)
  assert.equal(json.after, 3)
  assert.ok(json.drafts.every(d => d.stage === 'pool' && d.reviewStatus === 'pending' && d.onShelf === false))
})

test('模拟导入：抖音目标明确拒绝（接口未接通）', async () => {
  await call('/api/profiles', 'POST', { mode: 'scan', name: '抖店测试', target: 'douyin', filename: '对方商城样表.csv', content: SAMPLE_CSV })
  const { status, json } = await call('/api/import-fake', 'POST', { profile: '抖店测试', listFilename: '清单.csv', listContent: LIST_CSV, imageNames: IMAGE_NAMES })
  assert.equal(status, 403)
  assert.equal(json.ok, false)
  assert.match(json.error, /接口未接通/)
})

test('文件包：file-pack 拿回标准商品表＋改名计划', async () => {
  const { json } = await call('/api/file-pack', 'POST', { profile: '测试店', listFilename: '清单.csv', listContent: LIST_CSV, imageNames: IMAGE_NAMES })
  assert.equal(json.ok, true)
  assert.equal(json.count, 3)
  assert.match(json.sheetCsv, /商品名,分类,价格分/)
  assert.match(json.sheetCsv, /纯棉T恤/)
  assert.equal(json.renamePlan.length, 8) // 3 个主图列值 + 5 个图片文件
  assert.match(json.renamePlan[0].to, /^001_main_/)
})

test('排程：schedule-demo 回滚一致', async () => {
  const { json } = await call('/api/schedule-demo', 'POST', { profile: '测试店', statusJson: STATUS, rulesJson: RULES_READABLE, now: '2026-11-20T10:00' })
  assert.equal(json.ok, true)
  assert.equal(json.before, 'p1:false p2:false p3:true')
  assert.equal(json.after, 'p1:true p2:false p3:false')
  assert.equal(json.restored, 2)
  assert.equal(json.rolled, 'p1:false p2:false p3:true')
  assert.equal(json.consistent, true)
  const plan = await call('/api/schedule-plan', 'POST', { profile: '测试店', statusJson: STATUS, rulesJson: RULES_READABLE, now: '2026-11-20T10:00' })
  assert.equal(plan.json.actions.length, 2)
  assert.equal(plan.json.skipped.length, 1)
})

test('模板：生成模板草稿并校验通过', async () => {
  const { json } = await call('/api/generate-template', 'POST', { filename: '对方商城样表.csv', content: SAMPLE_CSV, name: '测试模板', target: 'generic-template' })
  assert.equal(json.ok, true)
  assert.equal(json.draft.templateName, '测试模板')
  assert.deepEqual(json.validationErrors, [])
  const v = await call('/api/templates/validate', 'POST', { content: JSON.stringify(json.draft) })
  assert.equal(v.json.ok, true)
})

test('参考与接入流程：平台字段表与 onboarding 数据与适配器一致', async () => {
  const pf = await call('/api/platform-fields?platform=douyin')
  assert.equal(pf.json.label, '抖音（抖店）')
  assert.ok(pf.json.requiredFields.includes('运费模板'))
  const sf = await call('/api/storefront-fields?platform=shopify')
  assert.equal(sf.json.label, 'Shopify（自建独立站）')
  const ob = await call('/api/onboarding')
  assert.equal(ob.json.ok, true)
  assert.equal(ob.json.selfHosted.length, 3)
  assert.equal(ob.json.thirdParty.length, 7)
  const dy = ob.json.thirdParty.find(t => t.target === 'douyin')
  assert.equal(dy.implemented, false)
  assert.equal(dy.requiredOnboarding.length, 4)
  assert.deepEqual(dy.methods.map(m => m.name), ['createProduct', 'getProduct', 'setShelf', 'listProducts'])
  assert.ok(dy.connectionShape.some(c => c.key === 'accessToken'))
})

test('配置编辑：PUT 改价格单位后校验通过；非法名拒绝', async () => {
  const got = await call('/api/profiles/' + encodeURIComponent('测试店'))
  const profile = got.json.profile
  profile.priceUnit = 'fen'
  const saved = await call('/api/profiles/' + encodeURIComponent('测试店'), 'PUT', profile)
  assert.equal(saved.json.ok, true)
  assert.equal(saved.json.profile.priceUnit, 'fen')
  const badName = await call('/api/profiles', 'POST', { mode: 'scan', name: '../坏名', target: 'generic-template', filename: '对方商城样表.csv', content: SAMPLE_CSV })
  assert.equal(badName.json.ok, false)
})
