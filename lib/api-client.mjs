// 接口调用层口子（第二轮）：每个适配器先把“以后接真实 API”的调用层形状定死，
// 现在没接口、没授权，所以 connect() 只校验连接配置形状、返回的客户端方法一律抛错，
// 绝不返回假成功。接口一通，接通方只需把 client 方法体换成真实请求，方法名与参数不变。
// connectionShape 里的值只写占位说明（如“你的 AppKey”），不写真实凭据；凭据只走配置文件。
export function connect(target, label, connection, connectionShape, methods, missingHint) {
  const conn = connection || {}
  for (const field of connectionShape) {
    if (field.required && (conn[field.key] === undefined || conn[field.key] === null || String(conn[field.key]).trim() === '')) {
      throw new Error(`接口未接通：${label} 缺少连接配置 ${field.key}（${field.label}）。${missingHint || ''}请先完成入驻与授权，再把凭据填进目标连接配置（不进代码与报告）`)
    }
  }
  const client = { target, label, connected: false, connectionShape: connectionShape.map(f => f.key), methods: methods.map(m => m.name) }
  for (const m of methods) {
    client[m.name] = () => {
      throw new Error(`接口未接通：${label} 方法 ${m.name}（${m.desc}）尚未实现真实调用。${missingHint || ''}接通后按本方法签名实现即可，不改调用方`)
    }
  }
  return client
}
// 各适配器共用的四方法签名：建商品（草稿态）/ 读商品状态 / 上下架 / 按条件列商品。
export const STANDARD_METHODS = [
  { name: 'createProduct', desc: '按适配器 payload 建商品，只到草稿态、不直接上架' },
  { name: 'getProduct', desc: '按平台/店铺商品 ID 读回商品状态与字段' },
  { name: 'setShelf', desc: '按商品 ID 上架（true）或下架（false）' },
  { name: 'listProducts', desc: '按分类/状态列商品（供批量上下架选择器用）' },
]
