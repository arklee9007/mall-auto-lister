// 内存假目标：供适配器一致性测试与 Sam 中途测试的模拟店。实现与真实目标相同的写入口径（草稿态，不直接上架）。
export function createFakeTarget(capabilities) {
  const products = []
  return {
    capabilities,
    list: () => products.map(p => ({ ...p })),
    count: () => products.length,
    insertDraft(payload) {
      const id = 'draft-' + (products.length + 1)
      const row = { _id: id, ...JSON.parse(JSON.stringify(payload)), stage: 'pool', reviewStatus: 'pending', onShelf: false }
      products.push(row)
      return row
    },
    snapshot: () => JSON.parse(JSON.stringify(products)),
    restore(snap) { products.length = 0; products.push(...JSON.parse(JSON.stringify(snap))) },
  }
}
