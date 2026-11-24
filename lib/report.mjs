// 报告提醒统一计数（F1）：解析提醒与适配提醒分开计、总数一致，首行一次说清。
export function summarizeReminders(parseWarnings, adapterNotes) {
  const parse = (parseWarnings || []).length
  const adapter = (adapterNotes || []).length
  return { parse, adapter, total: parse + adapter }
}
export function formatReminderSummary(s) {
  return `提醒共 ${s.total} 条（解析提醒 ${s.parse} 条，适配提醒 ${s.adapter} 条）`
}
