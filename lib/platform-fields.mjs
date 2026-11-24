// 三平台字段映射表（配置数据，先行；接口实现留待以后）。
// 口径：statusNames 为 null 表示未查到官方状态枚举，待接通接口或进商家后台实测后补，不编造。
// 品类扩展字段的细粒度以平台类目属性接口（Get Attributes / 类目属性表）当期返回为准。
export const PLATFORM_FIELDS = {
  douyin: {
    platform: 'douyin',
    label: '抖音（抖店）',
    requiredFields: ['类目', '商品标题', '商品描述', '主图', '规格SKU（价格/库存）', '运费模板', '品牌'],
    categoryFields: {
      服装: ['尺码表', '材质成分', '适用性别', '适用季节'],
      美妆: ['成分', '净含量', '保质期', '功效', '特殊用途化妆品与否', '生产许可证'],
      食品: ['食品名称', '配料表', '生产日期', '保质期', '贮存条件', '产品标准代号', 'SC编号', '营养成分表'],
      数码: ['品牌', '型号', '保修期', '适用机型'],
      家居: ['材质', '尺寸', '适用场景'],
      母婴: ['适用年龄', '材质', '安全标准'],
    },
    specDims: {
      服装: ['颜色', '尺码'],
      美妆: ['色号', '容量'],
      食品: ['口味', '包装规格'],
      数码: ['颜色', '内存容量'],
      家居: ['颜色', '尺寸'],
      母婴: ['尺码', '款式'],
    },
    imageRules: { mainMin: 5, mainMax: 9, formats: ['PNG', 'JPG', 'JPEG'], maxSizeMB: 5, sizeRange: '300x300-4000x4000', detailImagesMax: 30, noWatermark: true },
    specMaxDims: 3, // TikTok Shop Create Product API：销售属性最多 3 类；单商品 SKU 上限 300（美/英/欧/日等市场）
    skuMax: 300,
    statusNames: ['售卖中', '已下架', '审核中', '审核不通过', '封禁'], // 商品管理分“售卖中 / 已下架”两栏；审核通过后状态为售卖中；下架走 /product/setOffline
    statusNamesNote: '售卖中/已下架来自抖店商家大学商品管理与开放平台文档（上架审核通过后状态为售卖中，放入仓库调用 /product/setOffline）；审核中/审核不通过/封禁为审核与处罚状态，见开放平台业务返回码',
    apiMethods: ['Get Categories（取类目）', 'Get Attributes（按类目取必填属性）', 'Upload Image（传图）', 'Create Product（建商品）', '上架商品（审核通过后状态为售卖中）', '/product/setOffline（放入仓库/下架，路径已核实）'],
    apiNotes: 'Get Categories → Get Attributes（按类目取必填属性）→ Upload Image → Create Product；必填缺失时可建草稿并返回缺失字段明细；须开放平台入驻＋商家授权；服装类须尺码表',
  },
  taobao: {
    platform: 'taobao',
    label: '淘宝',
    requiredFields: ['商品类目', '品牌', '商品属性', '宝贝标题', '一口价', '宝贝数量', '主图', '宝贝描述', '运费模板', '发货地'],
    categoryFields: {
      服装: ['材质成分', '适用季节', '尺码表'],
      美妆: ['成分', '净含量', '保质期', '功效', '特殊用途与否', '规格（正装/小样）'],
      食品: ['食品名称', '配料表', '生产日期', '保质期', '贮存条件', 'SC编号'],
      数码: ['品牌', '型号', '保修', '适用机型'],
      家居: ['材质', '尺寸', '风格'],
      母婴: ['适用年龄', '材质', '安全标准'],
    },
    specDims: {
      服装: ['颜色', '尺码'],
      美妆: ['色号', '容量'],
      食品: ['口味', '包装规格'],
      数码: ['颜色', '版本'],
      家居: ['颜色', '尺寸'],
      母婴: ['尺码', '款式'],
    },
    imageRules: { mainMin: 5, mainMax: 5, formats: ['JPG', 'PNG'], maxSizeMB: null, sizeRange: '800x800', note: '五张主图、800x800 为多家卖家教程口径（第五张用白底图便于手淘入池），官方帮助未明文写死，以后台为准' },
    specMaxDims: null, // 公开资料未给销售属性维数上限，待后台实测；引擎仍按 3 维上限
    skuMax: 80, // 卖家教程口径：默认 24 个自定义颜色＋56 个系统标准色，共 80 个 SKU；官方未明文，以后台为准
    statusNames: ['出售中', '仓库中'], // 下架商品进仓库
    statusNamesNote: '出售中/仓库中为千牛后台两栏；定时上下架为千牛后台功能，API 侧以 taobao.item.update 改状态为准',
    apiMethods: ['新版 schema 商品发布', 'taobao.item.add（老版）', 'taobao.item.update（改状态/上下架）'],
    apiNotes: '淘宝开放平台（TOP）：新版 schema 商品发布、taobao.item.add（老版）、taobao.item.update；调用须 AppKey＋AppSecret＋OAuth SessionKey＋HMAC-SHA256 签名',
  },
  xiaohongshu: {
    platform: 'xiaohongshu',
    label: '小红书',
    requiredFields: ['类目', '商品标题', '主图', '价格', '库存', '运费模板', '资质（按类目）'],
    categoryFields: {
      服装: ['材质', '尺码表', '适用场景'],
      美妆: ['成分', '净含量', '保质期', '功效', '品牌授权'],
      食品: ['食品名称', '净含量', '配料表', '生产日期', '保质期', '贮存条件', '产品标准代号', '生产企业名称', '生产企业地址', 'SC生产许可证编号', '营养成分表'],
      数码: ['品牌', '型号', '保修期'],
      家居: ['材质', '尺寸', '适用场景'],
      母婴: ['适用年龄', '材质', '安全标准'],
    },
    specDims: {
      服装: ['颜色', '尺码'],
      美妆: ['色号', '容量'],
      食品: ['口味', '包装规格'],
      数码: ['颜色', '版本'],
      家居: ['颜色', '尺寸'],
      母婴: ['尺码', '款式'],
    },
    imageRules: { mainMin: 3, mainMax: null, formats: null, maxSizeMB: null, sizeRange: null, note: '食品须上传标签实拍图（配料、生产信息、营养表拍全、不遮挡文字）' },
    specMaxDims: null, // 公开资料未给规格维上限与 SKU 上限，待后台实测；引擎仍按 3 维上限
    skuMax: null,
    statusNames: ['售卖中', '已下架', '待审核', '审核中', '审核不通过'], // 审核状态：待审核/审核中/审核通过/审核不通过；商品上架后状态为售卖中
    statusNamesNote: '审核四态来自小红书商品审核进度说明（待审核/审核中/审核通过/审核不通过，约 24 小时内完成）；售卖中来自店铺后台商品列表实操（上架后显示售卖中）；已下架为上架/下架操作对应状态',
    apiMethods: ['商品创建/查询/修改/删除（商品接口）', '库存接口', '订单接口', '售后接口'],
    apiNotes: '小红书电商开放平台：订单、商品、库存、售后；面向开店商家与认证服务商，须主体资质；个人开发者基本拿不到权限（公开资料口径）',
  },
}
export function platformFieldMap(platform) {
  const p = PLATFORM_FIELDS[platform]
  if (!p) throw new Error('未知平台：' + platform)
  return p
}
