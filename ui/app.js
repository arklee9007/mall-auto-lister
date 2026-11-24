// 自动化插件 · 界面版 v1.3.0 前端（无构建、无 CDN，纯静态 JS）
// 所有操作都走 /api/*，引擎逻辑全在服务器端（lib/ 现成函数），浏览器只负责传文件文本与展示结果。
const TARGETS = [
  ['generic-template', '通用商城模板'], ['wander', 'WANDER 本店'], ['file-only', '文件版（无后台）'],
  ['douyin', '抖音（抖店）'], ['taobao', '淘宝'], ['xiaohongshu', '小红书'],
  ['shopify', 'Shopify'], ['woocommerce', 'WooCommerce'], ['youzan', '有赞'], ['shopline', 'SHOPLINE'],
]
const FIELD_LABELS = {
  name: '商品名', category: '分类', price: '价格', stock: '库存', mainImage: '主图',
  freightMode: '运费方式', description: '描述', subtitle: '副标题', keywords: '关键词',
  expiry: '保质期', netContent: '净含量', ingredients: '配料', efficacy: '功效', model: '型号', weight: '重量', brand: '品牌',
}
const REQUIRED_FIELDS = ['name', 'category', 'price', 'stock', 'mainImage', 'freightMode']
const S = {
  scan: null, // {filename, headers, proposal}
  editing: null, // 正在编辑的完整 profile 对象
  profiles: [],
  demo: null,
  dry: { profile: '', listFilename: '', listContent: '', imageNames: [], templateContent: '', templateFilename: '' },
}
const $ = id => document.getElementById(id)
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function msg(el, text, isErr) { if (!el) return; el.textContent = text || ''; el.className = 'msg' + (isErr ? ' err' : ' ok') }
async function api(path, method, body) {
  const r = await fetch(path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json()
  if (!j.ok) throw new Error(j.error || ('请求失败：' + r.status))
  return j
}
function readFileAsText(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('读取文件失败：' + file.name)); fr.readAsText(file) })
}
function downloadText(filename, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
function fillTargetSelect(sel, includeEmpty) {
  sel.innerHTML = (includeEmpty ? '<option value="">（不指定）</option>' : '') + TARGETS.map(([v, l]) => `<option value="${v}">${l}（${v}）</option>`).join('')
}
function fillProfileSelect(sel) {
  sel.innerHTML = S.profiles.map(p => `<option value="${esc(p.name)}">${esc(p.name)}（${esc(p.target || '')}）</option>`).join('') || '<option value="">（暂无配置，先去“对字段”页建一个）</option>'
}

// ---- 标签页 ----
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'))
  document.querySelectorAll('main .tab').forEach(x => x.classList.remove('active'))
  b.classList.add('active')
  $('tab-' + b.dataset.tab).classList.add('active')
  if (b.dataset.tab === 'onboarding') loadOnboarding()
}))

// ---- 一、对字段：扫描样表 ----
function renderProposal() {
  const { headers, proposal } = S.scan
  const opts = ['<option value="">（不映射）</option>'].concat(headers.map(h => `<option value="${esc(h)}">${esc(h)}</option>`)).join('')
  const row = (key, entry, isExt) => {
    const label = FIELD_LABELS[key] || key
    const req = REQUIRED_FIELDS.includes(key) ? ' <b class="req">必填</b>' : ''
    return `<tr><td>${label}${req}</td><td><select data-field="${key}" data-ext="${isExt ? 1 : 0}">${opts.replace(`value="${esc(entry.source || '')}"`, `value="${esc(entry.source || '')}" selected`)}</select></td>
      <td><select data-status="${key}" data-ext="${isExt ? 1 : 0}"><option value="auto"${entry.status === 'auto' ? ' selected' : ''}>auto（可直接用）</option><option value="review"${entry.status === 'review' ? ' selected' : ''}>review（须人确认）</option><option value="missing"${entry.status === 'missing' ? ' selected' : ''}>missing（缺失）</option></select></td></tr>`
  }
  let html = `<p>表头 ${headers.length} 列：${headers.map(esc).join('、')}</p>
  <table><thead><tr><th>目标字段</th><th>来源列（可改）</th><th>状态</th></tr></thead><tbody>
  ${Object.entries(proposal.columns).map(([k, v]) => row(k, v, false)).join('')}
  </tbody></table>
  <h4>扩展字段</h4>
  <table><tbody>${Object.keys(FIELD_LABELS).filter(k => !proposal.columns[k]).map(k => row(k, proposal.extensions[k] || { source: null, status: 'missing' }, true)).join('')}</tbody></table>
  <h4>规格维（提议）</h4><div id="specDimsEditor"></div><button id="addSpecDimBtn" type="button">加一维</button>
  <p>未映射列：${proposal.unmapped.join('、') || '无'}</p>
  <p>缺失必填映射：${proposal.missingRequired.join('、') || '无'}</p>
  ${proposal.specDimsOverflow ? '<p class="err">注意：规格维超过 3 维上限，请拆包或走定制适配</p>' : ''}`
  $('scanResult').innerHTML = html
  renderSpecDimsEditor($('specDimsEditor'), proposal.specDims)
  $('addSpecDimBtn').addEventListener('click', () => {
    S.scan.proposal.specDims.push({ name: '', source: '', status: 'review' })
    renderSpecDimsEditor($('specDimsEditor'), S.scan.proposal.specDims)
  })
}
function renderSpecDimsEditor(container, dims) {
  container.innerHTML = dims.map((d, i) => `<div class="spec-row"><label>维名 <input type="text" data-spec-name="${i}" value="${esc(d.name)}"></label><label>来源列 <input type="text" data-spec-source="${i}" value="${esc(d.source)}"></label><button type="button" data-spec-del="${i}">删除</button></div>`).join('') || '<p class="hint">无规格维（如颜色、尺码）。</p>'
  container.querySelectorAll('[data-spec-del]').forEach(b => b.addEventListener('click', () => {
    S.scan.proposal.specDims.splice(Number(b.dataset.specDel), 1)
    renderSpecDimsEditor(container, S.scan.proposal.specDims)
  }))
}
function buildMappingFromForm() {
  const columns = {}, extensions = {}
  document.querySelectorAll('#scanResult select[data-field]').forEach(sel => {
    const key = sel.dataset.field, isExt = sel.dataset.ext === '1'
    const statusSel = document.querySelector(`#scanResult select[data-status="${key}"][data-ext="${isExt ? 1 : 0}"]`)
    const entry = { source: sel.value || null, status: statusSel ? statusSel.value : (sel.value ? 'review' : 'missing') }
    if (isExt) { if (entry.source) extensions[key] = entry } else columns[key] = entry
  })
  const specDims = []
  document.querySelectorAll('#scanResult [data-spec-name]').forEach(inp => {
    const i = Number(inp.dataset.specName)
    const src = document.querySelector(`#scanResult [data-spec-source="${i}"]`)
    if (inp.value.trim() || (src && src.value.trim())) specDims.push({ name: inp.value.trim(), source: src ? src.value.trim() : inp.value.trim(), status: 'review' })
  })
  const used = new Set([...Object.values(columns), ...Object.values(extensions)].map(c => c.source).filter(Boolean).concat(specDims.map(d => d.source)))
  const unmapped = S.scan.headers.filter(h => !used.has(h))
  const missingRequired = REQUIRED_FIELDS.filter(f => !columns[f]?.source)
  return { columns, specDims, specDimsOverflow: specDims.length > 3, extensions, unmapped, missingRequired, needsReview: missingRequired.length > 0 || specDims.length > 3 || Object.values(columns).some(c => c.status === 'review') || specDims.length > 0 }
}
$('scanBtn').addEventListener('click', async () => {
  const file = $('scanFile').files[0]
  let filename = '', content = ''
  try {
    if (file) { filename = file.name; content = await readFileAsText(file) }
    else if ($('scanText').value.trim()) {
      content = $('scanText').value
      const t = content.trim()
      filename = (t.startsWith('{') || t.startsWith('[')) ? '粘贴的样表.json' : '粘贴的样表.csv'
    }
    else { msg($('scanMsg'), '请先选样表文件，或粘贴样表内容', true); return }
    const j = await api('/api/scan', 'POST', { filename, content })
    S.scan = { filename, headers: j.headers, proposal: j.proposal }
    renderProposal()
    msg($('scanMsg'), `扫描完成：表头 ${j.headers.length} 列，缺失必填映射：${j.proposal.missingRequired.join('、') || '无'}${j.note ? '；' + j.note : ''}`)
  } catch (e) { msg($('scanMsg'), e.message, true) }
})
$('saveProfileBtn').addEventListener('click', async () => {
  if (!S.scan) { msg($('saveProfileMsg'), '请先扫描样表', true); return }
  const name = $('saveProfileName').value.trim()
  if (!name) { msg($('saveProfileMsg'), '请填写配置名', true); return }
  try {
    const j = await api('/api/profiles', 'POST', { mode: 'scan', name, target: $('saveProfileTarget').value, mapping: buildMappingFromForm() })
    msg($('saveProfileMsg'), `配置已保存：${name}。缺失必填映射：${j.missingRequired.join('、') || '无'}；未映射列：${j.unmapped.join('、') || '无'}`)
    await refreshProfiles()
  } catch (e) { msg($('saveProfileMsg'), e.message, true) }
})
$('templateFileForProfile').addEventListener('change', async e => {
  const f = e.target.files[0]
  if (!f) return
  $('templateProfileName').value = $('templateProfileName').value || f.name.replace(/\.json$/i, '')
})
$('templateProfileBtn').addEventListener('click', async () => {
  const file = $('templateFileForProfile').files[0]
  const name = $('templateProfileName').value.trim()
  if (!file) { msg($('templateProfileMsg'), '请先选模板 JSON 文件', true); return }
  if (!name) { msg($('templateProfileMsg'), '请填写配置名', true); return }
  try {
    const content = await readFileAsText(file)
    const j = await api('/api/profiles', 'POST', { mode: 'template', name, target: $('templateProfileTarget').value || undefined, templateContent: content })
    msg($('templateProfileMsg'), `配置已生成（来自模板）：${name}。缺失必填映射：${j.missingRequired.join('、') || '无'}`)
    await refreshProfiles()
  } catch (e) { msg($('templateProfileMsg'), e.message, true) }
})

// ---- 配置列表与编辑 ----
async function refreshProfiles() {
  try {
    const j = await api('/api/profiles')
    S.profiles = j.profiles
    $('profileList').querySelector('tbody').innerHTML = S.profiles.map(p =>
      `<tr><td>${esc(p.name)}</td><td>${esc(p.target || '')}</td><td><button data-view="${esc(p.name)}">查看</button> <button data-edit="${esc(p.name)}">编辑</button> <button data-del="${esc(p.name)}">删除</button></td></tr>`).join('') || '<tr><td colspan="3">暂无配置</td></tr>'
    fillProfileSelect($('dryProfile'))
    $('profileList').querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => viewProfile(b.dataset.view)))
    $('profileList').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editProfile(b.dataset.edit)))
    $('profileList').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`确定删除配置「${b.dataset.del}」吗？`)) return
      try { await api('/api/profiles/' + encodeURIComponent(b.dataset.del), 'DELETE'); await refreshProfiles() } catch (e) { alert(e.message) }
    }))
  } catch (e) { $('profileList').querySelector('tbody').innerHTML = `<tr><td colspan="3">${esc(e.message)}</td></tr>` }
}
async function viewProfile(name) {
  try {
    const j = await api('/api/profiles/' + encodeURIComponent(name))
    $('profileDetail').innerHTML = `<h4>配置详情：${esc(name)}</h4><pre>${esc(JSON.stringify(j.profile, null, 2))}</pre>`
  } catch (e) { $('profileDetail').innerHTML = `<p class="err">${esc(e.message)}</p>` }
}
function renderEditMapping() {
  const p = S.editing, m = p.mapping
  const row = (key, entry, isExt) => {
    const label = FIELD_LABELS[key] || key
    const req = REQUIRED_FIELDS.includes(key) ? ' <b class="req">必填</b>' : ''
    return `<tr><td>${label}${req}</td><td><input type="text" data-efield="${key}" data-eext="${isExt ? 1 : 0}" value="${esc(entry.source || '')}" placeholder="来源列名，空 = 不映射"></td>
      <td><select data-estatus="${key}" data-eext="${isExt ? 1 : 0}"><option value="auto"${entry.status === 'auto' ? ' selected' : ''}>auto</option><option value="review"${entry.status === 'review' ? ' selected' : ''}>review</option><option value="missing"${entry.status === 'missing' ? ' selected' : ''}>missing</option></select></td></tr>`
  }
  $('editMapping').innerHTML = `<table><thead><tr><th>目标字段</th><th>来源列</th><th>状态</th></tr></thead><tbody>
    ${Object.entries(m.columns).map(([k, v]) => row(k, v, false)).join('')}
    ${Object.keys(FIELD_LABELS).filter(k => !m.columns[k]).map(k => row(k, m.extensions[k] || { source: null, status: 'missing' }, true)).join('')}
    </tbody></table>
    <h4>规格维</h4><div id="editSpecDims"></div><button id="editAddSpecDimBtn" type="button">加一维</button>
    <p>未映射列：${m.unmapped.join('、') || '无'}</p>`
  const renderDims = () => {
    $('editSpecDims').innerHTML = (m.specDims || []).map((d, i) => `<div class="spec-row"><label>维名 <input type="text" data-espec-name="${i}" value="${esc(d.name)}"></label><label>来源列 <input type="text" data-espec-source="${i}" value="${esc(d.source)}"></label><button type="button" data-espec-del="${i}">删除</button></div>`).join('') || '<p class="hint">无规格维。</p>'
    $('editSpecDims').querySelectorAll('[data-espec-del]').forEach(b => b.addEventListener('click', () => { m.specDims.splice(Number(b.dataset.especDel), 1); renderDims() }))
  }
  renderDims()
  $('editAddSpecDimBtn').addEventListener('click', () => { m.specDims.push({ name: '', source: '', status: 'review' }); renderDims() })
}
async function editProfile(name) {
  try {
    const j = await api('/api/profiles/' + encodeURIComponent(name))
    S.editing = j.profile
    $('editProfileName').textContent = name
    fillTargetSelect($('editTarget')); $('editTarget').value = S.editing.target || 'generic-template'
    $('editPriceUnit').value = S.editing.priceUnit || 'yuan'
    renderEditMapping()
    $('editFreight').value = (S.editing.freightTemplates || []).map(t => `${t.name}，${t.chargeType}`).join('\n')
    $('editFreightDefault').value = S.editing.freightTemplateDefault || ''
    $('profileEditor').classList.remove('hidden')
    $('profileEditor').scrollIntoView()
  } catch (e) { alert(e.message) }
}
$('editCancelBtn').addEventListener('click', () => { S.editing = null; $('profileEditor').classList.add('hidden') })
$('editSaveBtn').addEventListener('click', async () => {
  const p = S.editing
  p.target = $('editTarget').value
  p.priceUnit = $('editPriceUnit').value
  const columns = {}, extensions = {}
  document.querySelectorAll('#editMapping input[data-efield]').forEach(inp => {
    const key = inp.dataset.efield, isExt = inp.dataset.eext === '1'
    const st = document.querySelector(`#editMapping select[data-estatus="${key}"][data-eext="${isExt ? 1 : 0}"]`)
    const entry = { source: inp.value.trim() || null, status: st ? st.value : (inp.value.trim() ? 'review' : 'missing') }
    if (isExt) { if (entry.source) extensions[key] = entry } else columns[key] = entry
  })
  const specDims = []
  document.querySelectorAll('#editMapping [data-espec-name]').forEach(inp => {
    const i = Number(inp.dataset.especName)
    const src = document.querySelector(`#editMapping [data-espec-source="${i}"]`)
    if (inp.value.trim() || (src && src.value.trim())) specDims.push({ name: inp.value.trim(), source: src ? src.value.trim() : inp.value.trim(), status: 'review' })
  })
  p.mapping.columns = columns; p.mapping.extensions = extensions; p.mapping.specDims = specDims
  p.mapping.specDimsOverflow = specDims.length > 3
  const used = new Set([...Object.values(columns), ...Object.values(extensions)].map(c => c.source).filter(Boolean).concat(specDims.map(d => d.source)))
  p.mapping.unmapped = (p.mapping.unmapped || []).filter(h => !used.has(h))
  p.mapping.missingRequired = REQUIRED_FIELDS.filter(f => !columns[f]?.source)
  p.mapping.needsReview = p.mapping.missingRequired.length > 0 || specDims.length > 3 || Object.values(columns).some(c => c.status === 'review') || specDims.length > 0
  // 运费模板：只改名与计费方式，区域与价格结构原样保留
  const freightLines = $('editFreight').value.split('\n').map(s => s.trim()).filter(Boolean)
  const old = p.freightTemplates || []
  p.freightTemplates = freightLines.map((line, i) => {
    const [name, chargeType] = line.split(/[,，]/).map(s => s.trim())
    const keep = old[i] || { regions: [{ region: '全国（默认）', firstUnit: 1, firstFeeCents: 800, additionalUnit: 1, additionalFeeCents: 200 }], freeThresholdCents: null, note: '改成你后台已建好的模板名与价格；工具只往里填，不另编模板' }
    return { ...keep, name: name || keep.name, chargeType: chargeType || keep.chargeType || '按件' }
  })
  p.freightTemplateDefault = $('editFreightDefault').value.trim()
  try {
    await api('/api/profiles/' + encodeURIComponent(p.profileName), 'PUT', p)
    msg($('editMsg'), '已保存。')
    await refreshProfiles()
  } catch (e) { msg($('editMsg'), e.message, true) }
})
$('refreshProfilesBtn').addEventListener('click', refreshProfiles)

// ---- 二、试跑 ----
async function loadDemo() {
  if (S.demo) return S.demo
  S.demo = await api('/api/demo')
  return S.demo
}
$('dryListFile').addEventListener('change', async e => {
  const f = e.target.files[0]
  if (!f) return
  S.dry.listFilename = f.name
  S.dry.listContent = await readFileAsText(f)
  $('dryListText').value = S.dry.listContent
})
$('dryImages').addEventListener('change', e => {
  S.dry.imageNames = [...e.target.files].map(f => f.name).filter(n => /\.(png|jpe?g|webp|svg|gif)$/i.test(n))
  $('dryImageNames').textContent = S.dry.imageNames.length ? `已选 ${S.dry.imageNames.length} 个文件名：${S.dry.imageNames.join('、')}` : '未选图片（图片只按文件名筛，不上传内容）'
})
$('dryTemplateFile').addEventListener('change', async e => {
  const f = e.target.files[0]
  if (!f) return
  S.dry.templateContent = await readFileAsText(f)
  S.dry.templateFilename = f.name
  $('dryTemplateName').textContent = '已选专用模板：' + f.name + '（导入时用它现场生成配置，不改存量配置）'
})
$('dryFillDemoBtn').addEventListener('click', async () => {
  try {
    const d = await loadDemo()
    S.dry.listFilename = d.listFilename; S.dry.listContent = d.listCsv; S.dry.imageNames = d.imageNames
    $('dryListText').value = d.listCsv
    $('dryImageNames').textContent = `示例图片 ${d.imageNames.length} 个文件名：${d.imageNames.join('、')}`
    msg($('dryMsg'), '已填入示例清单与图片文件名。配置请在上方选一个（没有就点“自动建演示配置”）。')
  } catch (e) { msg($('dryMsg'), e.message, true) }
})
$('dryBuildDemoProfileBtn').addEventListener('click', async () => {
  try {
    const d = await loadDemo()
    const j = await api('/api/profiles', 'POST', { mode: 'scan', name: '测试店', target: 'generic-template', filename: d.sampleFilename, content: d.sampleCsv })
    msg($('dryMsg'), `演示配置「测试店」已建好（缺失必填映射：${j.missingRequired.join('、') || '无'}）。`)
    await refreshProfiles()
    $('dryProfile').value = '测试店'
  } catch (e) { msg($('dryMsg'), e.message, true) }
})
$('dryRefreshProfilesBtn').addEventListener('click', refreshProfiles)
$('dryRunBtn').addEventListener('click', async () => {
  const profile = $('dryProfile').value
  if (!profile) { msg($('dryMsg'), '请先选配置', true); return }
  const listContent = $('dryListText').value
  if (!listContent.trim()) { msg($('dryMsg'), '请先上传或粘贴商品清单', true); return }
  S.dry.profile = profile; S.dry.listContent = listContent
  if (!$('dryListFile').files[0]) {
    const t = listContent.trim()
    S.dry.listFilename = S.dry.listFilename || ((t.startsWith('{') || t.startsWith('[')) ? '清单.json' : '清单.csv')
  }
  try {
    const j = await api('/api/dry-run', 'POST', { profile, listFilename: S.dry.listFilename, listContent, imageNames: S.dry.imageNames, templateContent: S.dry.templateContent || undefined })
    $('dryResult').innerHTML = `
      <h3>试跑报告</h3>
      <p>解析：${j.productCount} 件商品，错误 ${j.errorCount} 条，${esc(j.summary)}</p>
      <p class="${j.valid ? 'ok' : 'err'}"><b>${esc(j.conclusion)}</b></p>
      ${j.errors.length ? `<h4>错误（${j.errors.length}）</h4><ul>${j.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      ${j.warnings.length ? `<h4>提醒（解析提醒）</h4><ul>${j.warnings.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      ${j.adapterNotes.length ? `<h4>适配提醒</h4><ul>${j.adapterNotes.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      <h4>运费映射</h4><ul>${j.freight.map(f => `<li>${esc(f.name)}：${esc(f.summary)}</li>`).join('')}</ul>
      <h4>首件翻译结果</h4><pre>${esc(JSON.stringify(j.firstPayload, null, 2))}</pre>`
    msg($('dryMsg'), `试跑完成：${j.productCount} 件商品，错误 ${j.errorCount} 条。`)
    updateDraftSummary()
  } catch (e) { msg($('dryMsg'), e.message, true) }
})

// ---- 三、看草稿和排程 ----
function updateDraftSummary() {
  $('draftSummary').textContent = S.dry.profile && S.dry.listContent
    ? `当前：配置「${S.dry.profile}」，清单 ${S.dry.listFilename}，图片 ${S.dry.imageNames.length} 个文件名${S.dry.templateContent ? '，专用模板：' + S.dry.templateFilename : ''}。`
    : '尚未选择配置与清单。'
}
$('draftFillDemoBtn').addEventListener('click', async () => {
  try {
    const d = await loadDemo()
    if (!S.profiles.find(p => p.name === '测试店')) {
      await api('/api/profiles', 'POST', { mode: 'scan', name: '测试店', target: 'generic-template', filename: d.sampleFilename, content: d.sampleCsv })
      await refreshProfiles()
    }
    S.dry.profile = '测试店'; S.dry.listFilename = d.listFilename; S.dry.listContent = d.listCsv; S.dry.imageNames = d.imageNames
    updateDraftSummary()
    msg($('importFakeMsg'), '已填入示例（配置：测试店）。')
  } catch (e) { msg($('importFakeMsg'), e.message, true) }
})
$('importFakeBtn').addEventListener('click', async () => {
  if (!S.dry.profile || !S.dry.listContent) { msg($('importFakeMsg'), '请先去“试跑”页选配置、填清单，或点“填入示例”', true); return }
  try {
    const j = await api('/api/import-fake', 'POST', { profile: S.dry.profile, listFilename: S.dry.listFilename, listContent: S.dry.listContent, imageNames: S.dry.imageNames, templateContent: S.dry.templateContent || undefined })
    $('importFakeResult').innerHTML = `<h4>模拟草稿：${j.before} → ${j.after} 件</h4>
      <table><thead><tr><th>草稿 ID</th><th>商品名</th><th>阶段</th><th>审核</th><th>上架</th></tr></thead><tbody>
      ${j.drafts.map(d => `<tr><td>${esc(d._id)}</td><td>${esc(d.name)}</td><td>${esc(d.stage)}</td><td>${esc(d.reviewStatus)}</td><td>${esc(String(d.onShelf))}</td></tr>`).join('')}
      </tbody></table><p class="hint">${esc(j.note)}</p>`
    msg($('importFakeMsg'), '模拟导入完成。')
  } catch (e) {
    $('importFakeResult').innerHTML = `<p class="err">${esc(e.message)}</p>`
    msg($('importFakeMsg'), e.message, true)
  }
})
$('filePackBtn').addEventListener('click', async () => {
  if (!S.dry.profile || !S.dry.listContent) { msg($('filePackMsg'), '请先去“试跑”页选配置、填清单，或点“填入示例”', true); return }
  try {
    const j = await api('/api/file-pack', 'POST', { profile: S.dry.profile, listFilename: S.dry.listFilename, listContent: S.dry.listContent, imageNames: S.dry.imageNames, templateContent: S.dry.templateContent || undefined })
    $('filePackResult').innerHTML = `<p>文件包已生成，共 ${j.count} 件。</p>
      <button id="dlSheetBtn">下载 标准商品表.csv</button>
      <button id="dlRenameBtn">下载 图片改名计划.json</button>
      <h4>图片改名计划</h4><pre>${esc(JSON.stringify(j.renamePlan, null, 2))}</pre>`
    $('dlSheetBtn').addEventListener('click', () => downloadText('标准商品表.csv', j.sheetCsv, 'text/csv;charset=utf-8'))
    $('dlRenameBtn').addEventListener('click', () => downloadText('图片改名计划.json', JSON.stringify(j.renamePlan, null, 2), 'application/json;charset=utf-8'))
    msg($('filePackMsg'), '文件包已生成。')
  } catch (e) { msg($('filePackMsg'), e.message, true) }
})
$('schedFillDemoBtn').addEventListener('click', async () => {
  try {
    const d = await loadDemo()
    $('schedStatus').value = JSON.stringify(d.statusJson, null, 2)
    $('schedRules').value = JSON.stringify(d.rulesReadableJson, null, 2)
    msg($('schedMsg'), '已填入示例状态与规则（可读时间写法）。')
  } catch (e) { msg($('schedMsg'), e.message, true) }
})
async function runSchedule(kind) {
  const profile = S.dry.profile || '测试店'
  if (!S.profiles.find(p => p.name === profile)) { msg($('schedMsg'), `排程须先有配置「${profile}」：请先在“对字段”页建配置，或点“填入示例”自动建演示配置`, true); return }
  const now = $('schedNow').value.trim() || undefined
  try {
    const j = await api('/api/' + kind, 'POST', { profile, statusJson: $('schedStatus').value, rulesJson: $('schedRules').value, now })
    if (kind === 'schedule-plan') {
      $('schedResult').innerHTML = `<h4>计划（${esc(j.planTime)}，${esc(j.timezone)}）</h4>
        <p>动作 ${j.actions.length} 个，跳过 ${j.skipped.length} 个，报警 ${j.alarms.length} 条</p>
        ${j.actions.map(a => `<p>[动作] ${esc(a.action)} ${esc(a.name)}（${esc(a.id)}）</p>`).join('')}
        ${j.skipped.map(s => `<p>[跳过] ${esc(s.id)}：${esc(s.reason)}</p>`).join('')}
        ${j.alarms.map(a => `<p>[报警] ${esc(a)}</p>`).join('')}`
    } else {
      $('schedResult').innerHTML = `<h4>模拟执行与回滚（${esc(j.planTime)}，${esc(j.timezone)}）</h4>
        <p>执行前：${esc(j.before)}</p><p>执行后：${esc(j.after)}</p>
        <p>回滚 ${j.restored} 条后：${esc(j.rolled)}</p>
        <p class="${j.consistent ? 'ok' : 'err'}"><b>回滚一致：${j.consistent ? '是' : '否'}</b></p>
        ${j.alarms.map(a => `<p>[报警] ${esc(a)}</p>`).join('')}`
    }
    msg($('schedMsg'), '完成。')
  } catch (e) { msg($('schedMsg'), e.message, true) }
}
$('schedPlanBtn').addEventListener('click', () => runSchedule('schedule-plan'))
$('schedDemoBtn').addEventListener('click', () => runSchedule('schedule-demo'))

// ---- 模板管理 ----
$('genFile').addEventListener('change', async e => {
  const f = e.target.files[0]
  if (f) $('genFields').value = ''
})
$('genBtn').addEventListener('click', async () => {
  const file = $('genFile').files[0]
  try {
    let body = { name: $('genName').value.trim() || '我的专用模板', target: $('genTarget').value }
    if (file) { body.filename = file.name; body.content = await readFileAsText(file) }
    else if ($('genFields').value.trim()) { body.fields = $('genFields').value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean) }
    else { msg($('genMsg'), '请先选样表文件，或直接填字段名', true); return }
    const j = await api('/api/generate-template', 'POST', body)
    $('genResult').innerHTML = `<h4>模板草稿已生成</h4>
      <p>字段 ${j.draft.fields.length} 个（必填 6 项已映射 ${j.draft.fields.filter(f => f.required && f.sourceColumn).length}/6）；分类 ${j.draft.categories.join('、') || '（无，请自己填）'}；规格维 ${j.draft.specDims.length} 个；未认出列：${j.draft.unmappedFields.join('、') || '无'}</p>
      ${j.validationErrors.length ? `<p class="err">校验提醒：${esc(j.validationErrors.join('；'))}</p>` : ''}
      <pre>${esc(JSON.stringify(j.draft, null, 2))}</pre>
      <button id="dlTemplateBtn">下载模板 JSON</button>`
    $('dlTemplateBtn').addEventListener('click', () => downloadText(($('genName').value.trim() || '我的专用模板') + '.json', JSON.stringify(j.draft, null, 2), 'application/json;charset=utf-8'))
    $('tplEditText').value = JSON.stringify(j.draft, null, 2)
    msg($('genMsg'), '模板草稿已生成（已同步填入下方编辑框）。')
  } catch (e) { msg($('genMsg'), e.message, true) }
})
$('tplValidateBtn').addEventListener('click', async () => {
  try {
    const j = await fetch('/api/templates/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: $('tplEditText').value }) }).then(r => r.json())
    if (j.ok) { $('tplResult').innerHTML = `<p class="ok">${esc(j.summary)}</p>`; msg($('tplMsg'), '模板校验通过。') }
    else { $('tplResult').innerHTML = `<p class="err">校验失败：</p><ul>${j.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`; msg($('tplMsg'), '模板校验失败，见下方。', true) }
  } catch (e) { msg($('tplMsg'), e.message, true) }
})
$('tplBuildBtn').addEventListener('click', async () => {
  const name = $('tplBuildName').value.trim()
  if (!name) { msg($('tplMsg'), '请填写配置名', true); return }
  try {
    const j = await api('/api/profiles', 'POST', { mode: 'template', name, templateContent: $('tplEditText').value })
    msg($('tplMsg'), `配置已生成（来自模板）：${name}。缺失必填映射：${j.missingRequired.join('、') || '无'}`)
    await refreshProfiles()
  } catch (e) { msg($('tplMsg'), e.message, true) }
})

// ---- 参考 ----
function renderFieldMap(el, fm) {
  const catRows = Object.entries(fm.categoryFields || {}).map(([c, fs]) => `<tr><td>${esc(c)}</td><td>${(fs || []).map(esc).join('、')}</td></tr>`).join('')
  const specRows = Object.entries(fm.specDims || {}).map(([c, ds]) => `<tr><td>${esc(c)}</td><td>${(ds || []).map(esc).join('、')}</td></tr>`).join('')
  el.innerHTML = `<h4>${esc(fm.label)}</h4>
    <p>必填字段：${(fm.requiredFields || []).map(esc).join('、')}</p>
    <p>规格维上限：${fm.specMaxDims ?? '待核实'}；SKU 上限：${fm.skuMax ?? '待核实'}</p>
    ${fm.imageRules ? `<p>图片要求：主图 ${fm.imageRules.mainMin ?? '?'}–${fm.imageRules.mainMax ?? '?'} 张，格式 ${(fm.imageRules.formats || []).join('/')}，单张上限 ${fm.imageRules.maxSizeMB ?? '待核实'}MB${fm.imageRules.note ? '；' + esc(fm.imageRules.note) : ''}</p>` : ''}
    <h5>各品类扩展字段</h5><table><thead><tr><th>品类</th><th>字段</th></tr></thead><tbody>${catRows}</tbody></table>
    <h5>各品类规格维</h5><table><thead><tr><th>品类</th><th>规格维</th></tr></thead><tbody>${specRows}</tbody></table>
    ${fm.statusNames ? `<p>上下架状态：${fm.statusNames.map(esc).join('、')}</p>` : ''}
    ${fm.statusNamesNote ? `<p class="hint">${esc(fm.statusNamesNote)}</p>` : ''}
    ${fm.freightNote ? `<p>运费：${esc(fm.freightNote)}</p>` : ''}
    ${fm.apiNotes ? `<p class="hint">${esc(fm.apiNotes)}</p>` : ''}`
}
$('refPlatformBtn').addEventListener('click', async () => {
  try { const j = await api('/api/platform-fields?platform=' + $('refPlatform').value); renderFieldMap($('refPlatformResult'), j) }
  catch (e) { $('refPlatformResult').innerHTML = `<p class="err">${esc(e.message)}</p>` }
})
$('refStoreBtn').addEventListener('click', async () => {
  try { const j = await api('/api/storefront-fields?platform=' + $('refStore').value); renderFieldMap($('refStoreResult'), j) }
  catch (e) { $('refStoreResult').innerHTML = `<p class="err">${esc(e.message)}</p>` }
})

// ---- 接入流程 ----
const AFTER_CONNECT_STEPS = [
  '按上面清单完成入驻与商家授权（入驻主体、开放平台应用、Token／密钥）。',
  '凭据填进目标连接配置（config/targets.json），不进代码与报告。',
  '调 connect() 校验连接配置形状：缺必填项会直接报错，不静默通过。',
  '把 client 的四个方法体换成真实请求：createProduct（建商品，只到草稿态）、getProduct（读商品状态）、setShelf（上架／下架）、listProducts（按条件列商品）。方法名与参数不变，不改调用方。',
  'dry-run 看映射 → import-fake 看草稿，确认草稿态正确，再走正式流程。',
  '上下架规则按该平台的 SHELF 状态名配 sellableStates（可售态才允许动）。',
]
let onboardingLoaded = false
async function loadOnboarding() {
  if (onboardingLoaded) return
  try {
    const j = await api('/api/onboarding')
    const selfHtml = j.selfHosted.map(s => `<div class="card onboard">
      <h3>${esc(s.label)} <span class="badge ok">咱们这边已就绪</span></h3>
      <h4>咱们这边已做好的部分</h4><p>${esc(s.ready)}</p>
      <h4>商家要准备的东西</h4><p>${esc(s.merchant)}</p>
      <h4>还缺的第三方开口（以及接通后的步骤）</h4><p>${esc(s.missing)}</p></div>`).join('')
    const plats = j.thirdParty.filter(t => t.kind === 'platform')
    const stores = j.thirdParty.filter(t => t.kind === 'storefront')
    const renderThird = (t) => `<div class="card onboard">
      <h3>${esc(t.label)} <span class="badge warn">等第三方开口：写入口未接通</span></h3>
      <h4>咱们这边已做好的部分</h4>
      <p>字段映射完整（必填、品类扩展字段、规格维、图片要求、上下架状态名均已按公开资料写死，查不到的标待实测）；接口调用层已定死四个方法：${t.methods.map(m => `${esc(m.name)}（${esc(m.desc)}）`).join('、')}；上下架状态：${t.shelf ? `上架 ${esc(t.shelf.onShelf)}、下架 ${esc(t.shelf.offShelf)}、可售态 ${esc((t.shelf.sellableStates || []).join('、'))}` : '待核实'}；SKU 上限：${t.skuMax ?? '待核实'}。</p>
      <h4>商家要准备的东西（REQUIRED_ONBOARDING）</h4>
      <table><thead><tr><th>事项</th><th>内容</th><th>谁负责</th></tr></thead><tbody>
      ${t.requiredOnboarding.map(r => `<tr><td>${esc(r.item)}</td><td>${esc(r.detail)}</td><td>${esc(r.owner)}</td></tr>`).join('')}
      </tbody></table>
      <h4>连接配置要填的东西（connect() 校验形状）</h4>
      <table><thead><tr><th>键</th><th>说明</th><th>必填</th></tr></thead><tbody>
      ${t.connectionShape.map(c => `<tr><td>${esc(c.key)}</td><td>${esc(c.label)}</td><td>${c.required ? '是' : '否'}</td></tr>`).join('')}
      </tbody></table>
      <h4>还缺的第三方开口（以及接通后的步骤）</h4>
      <p>缺：上面清单里的入驻与授权没完成，平台／店铺的 API 开口就没打开；现在调 connect() 会直接报缺连接配置，调四个接口方法会直接抛“接口未接通”，不返回假成功。申请链接、审批时限、费用以各平台当期口径为准，这里不写。</p>
      <ol>${AFTER_CONNECT_STEPS.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>`
    $('onboardingResult').innerHTML = `<h3>自有后台</h3>${selfHtml}<h3>第三方平台（抖音／淘宝／小红书）</h3>${plats.map(renderThird).join('')}<h3>自建店（Shopify／WooCommerce／有赞／SHOPLINE）</h3>${stores.map(renderThird).join('')}`
    onboardingLoaded = true
  } catch (e) { $('onboardingResult').innerHTML = `<p class="err">${esc(e.message)}</p>` }
}

// ---- 初始化 ----
fillTargetSelect($('saveProfileTarget'))
fillTargetSelect($('templateProfileTarget'), true)
fillTargetSelect($('genTarget'))
fillTargetSelect($('editTarget'))
refreshProfiles()
