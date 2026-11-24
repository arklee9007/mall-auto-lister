// 四家常用个人平台/自建店字段映射表（第二轮，配置数据；接口实现留待以后）。
// 名单定法：从 Shopify、WooCommerce、有赞、微盟、Shopline 五家里挑了公开商品发布说明最完整、
// 个人卖家最常用的四家。微盟未进：公开的商品导入字段资料不如这四家完整，且微盟主打门店与
// 小程序服务商模式，个人卖家常用度低于有赞；如 Sam 要加，同样按本文件格式补一条即可。
// 口径：statusNames 为 null 表示未查到官方状态枚举，待后台实测后补，不编造；
// “教程口径”表示多家卖家教程一致、官方帮助未明文写死，以后台为准。
export const SHOP_FRONT_FIELDS = {
  shopify: {
    platform: 'shopify',
    label: 'Shopify（自建独立站）',
    requiredFields: ['Title（商品名，新商品唯一必填）', 'URL handle（多规格/更新时必填）', 'Variant Price（规格价格）', 'Variant Inventory Qty（规格库存）'],
    categoryFields: {
      服装: ['Product Category（标准分类）', 'Type（自定类型）', 'Tags'],
      美妆: ['Product Category（标准分类）', 'Type（自定类型）', 'Tags'],
      食品: ['Product Category（标准分类）', 'Type（自定类型）', 'Tags'],
      数码: ['Product Category（标准分类）', 'Type（自定类型）', 'Tags'],
      家居: ['Product Category（标准分类）', 'Type（自定类型）', 'Tags'],
      母婴: ['Product Category（标准分类）', 'Type（自定类型）', 'Tags'],
    },
    specDims: {
      服装: ['Option1', 'Option2', 'Option3'],
      美妆: ['Option1', 'Option2', 'Option3'],
      食品: ['Option1', 'Option2', 'Option3'],
      数码: ['Option1', 'Option2', 'Option3'],
      家居: ['Option1', 'Option2', 'Option3'],
      母婴: ['Option1', 'Option2', 'Option3'],
    },
    specMaxDims: 3, // Shopify CSV 规格选项上限就是 3（Option1–3），单商品最多 2048 个规格组合
    skuMax: 2048,
    imageRules: { mainMin: 1, mainMax: 250, formats: ['JPG', 'PNG', 'GIF', 'WEBP'], maxSizeMB: null, sizeRange: null, note: '单商品最多 250 张图；CSV 文件上限 15MB；图片用 URL（Image Src 列）' },
    statusNames: ['active', 'draft', 'archived'], // 商品状态；CSV 导入用 Published 列 TRUE/FALSE
    statusNamesNote: '导入只到草稿：Published 列填 FALSE，对应 draft；上架须在后台改 active',
    freightNote: 'Shopify 商品本身无运费模板字段：运费在后台 Settings → Shipping and delivery 按配送区域与费率设置；固定运费/模板名由适配器写入备注，买家须在后台建好对应费率',
    apiNotes: 'Shopify Admin API（GraphQL/REST）：须店铺订阅＋自定义应用或 OAuth；商品用 productCreate，上下架改 status 字段',
  },
  woocommerce: {
    platform: 'woocommerce',
    label: 'WooCommerce（WordPress 自建店）',
    requiredFields: ['Name（商品名，内置导入唯一必填）', 'Type（simple/variable，非简单商品时必填）', 'SKU（强烈建议，更新去重靠它）', 'Regular price（价格）', 'Published（1 上架 / 0 草稿）'],
    categoryFields: {
      服装: ['Categories', 'Tags', 'Attribute 1 name/values'],
      美妆: ['Categories', 'Tags', 'Attribute 1 name/values'],
      食品: ['Categories', 'Tags', 'Attribute 1 name/values'],
      数码: ['Categories', 'Tags', 'Attribute 1 name/values'],
      家居: ['Categories', 'Tags', 'Attribute 1 name/values'],
      母婴: ['Categories', 'Tags', 'Attribute 1 name/values'],
    },
    specDims: {
      服装: ['Attribute 1', 'Attribute 2', 'Attribute 3'],
      美妆: ['Attribute 1', 'Attribute 2', 'Attribute 3'],
      食品: ['Attribute 1', 'Attribute 2', 'Attribute 3'],
      数码: ['Attribute 1', 'Attribute 2', 'Attribute 3'],
      家居: ['Attribute 1', 'Attribute 2', 'Attribute 3'],
      母婴: ['Attribute 1', 'Attribute 2', 'Attribute 3'],
    },
    specMaxDims: null, // 公开资料未给属性个数上限，待后台实测；引擎仍按 3 维上限
    skuMax: null,
    imageRules: { mainMin: 1, mainMax: null, formats: null, maxSizeMB: null, sizeRange: null, note: '图片用完整 URL（Images 列，多张逗号分隔）；内置导入支持简单商品与可变商品' },
    statusNames: ['publish', 'draft', 'private'], // WordPress 文章状态；导入用 Published 列 1/0
    statusNamesNote: '导入只到草稿：Published 列填 0，对应 draft；上架须在后台改 publish',
    freightNote: 'WooCommerce 运费按配送区域＋运费方式（统一费率/按重量等）在后台设置；商品可指定 Shipping class（运费等级），适配器把固定运费/模板名写入 Shipping class 备注，买家须在后台建好对应等级',
    apiNotes: 'WooCommerce REST API：须 WordPress 站点＋ WooCommerce 插件＋ API 密钥（Consumer Key/Secret）；商品用 /wp-json/wc/v3/products，上下架改 status 字段',
  },
  youzan: {
    platform: 'youzan',
    label: '有赞微商城',
    requiredFields: ['商品名称', '商品图', '价格', '库存', '规格项（多规格时）', '物流信息（发货地/配送范围/运费规则）'],
    categoryFields: {
      服装: ['规格项：颜色、尺码', '商品编码', '条码'],
      美妆: ['规格项：色号、容量', '商品编码', '条码'],
      食品: ['规格项：口味、包装规格', '商品编码', '条码'],
      数码: ['规格项：颜色、版本', '商品编码', '条码'],
      家居: ['规格项：颜色、尺寸', '商品编码', '条码'],
      母婴: ['规格项：尺码、款式', '商品编码', '条码'],
    },
    specDims: {
      服装: ['颜色', '尺码'],
      美妆: ['色号', '容量'],
      食品: ['口味', '包装规格'],
      数码: ['颜色', '版本'],
      家居: ['颜色', '尺寸'],
      母婴: ['尺码', '款式'],
    },
    specMaxDims: null, // 公开资料未给规格维上限，待后台实测；引擎仍按 3 维上限
    skuMax: null,
    imageRules: { mainMin: 1, mainMax: null, formats: null, maxSizeMB: null, sizeRange: null, note: '商品图必填；批量导入须用后台当期下载的模板，旧模板不建议沿用' },
    statusNames: ['商品库', '已发布', '已上架', '已下架'],
    statusNamesNote: '有赞三段：已导入商品库 ≠ 已发布到店铺 ≠ 已上架可售；导入只到商品库',
    freightNote: '运费规则在发布页物流信息里填：发货地、配送范围、运费规则须与实际能力一致；运费模板须先在有赞后台物流设置里建好，工具只填模板名',
    apiNotes: '有赞云开放平台：须有赞店铺＋开放平台应用（AppKey/AppSecret＋OAuth）；批量导入走后台 商品中心 → 商品库 → 商品导入 → 下载模板',
  },
  shopline: {
    platform: 'shopline',
    label: 'SHOPLINE',
    requiredFields: ['Product Handle（商品代号）', 'Product Name（商品名）', 'Images（图片）', 'Price（建议填）', 'Quantity（建议填）', 'Categories（建议填）'],
    categoryFields: {
      服装: ['Product Type', 'Vendor', 'Tag'],
      美妆: ['Product Type', 'Vendor', 'Tag'],
      食品: ['Product Type', 'Vendor', 'Tag'],
      数码: ['Product Type', 'Vendor', 'Tag'],
      家居: ['Product Type', 'Vendor', 'Tag'],
      母婴: ['Product Type', 'Vendor', 'Tag'],
    },
    specDims: {
      服装: ['Option1', 'Option2', 'Option3', 'Option4', 'Option5'],
      美妆: ['Option1', 'Option2', 'Option3', 'Option4', 'Option5'],
      食品: ['Option1', 'Option2', 'Option3', 'Option4', 'Option5'],
      数码: ['Option1', 'Option2', 'Option3', 'Option4', 'Option5'],
      家居: ['Option1', 'Option2', 'Option3', 'Option4', 'Option5'],
      母婴: ['Option1', 'Option2', 'Option3', 'Option4', 'Option5'],
    },
    specMaxDims: 5, // SHOPLINE 商品文件支持 Option1–5；本插件引擎上限 3 维，4–5 维商品须拆包或走定制适配
    skuMax: null,
    imageRules: { mainMin: 1, mainMax: null, formats: null, maxSizeMB: null, sizeRange: null, note: '商品文件为 CSV 或 XLSX，上限 40MB；模板含两行表头（说明行＋字段行），都须保留；多规格每组合一行，Title 只填首行' },
    statusNames: ['Activated', 'Deactivated'], // 商品状态；另有 Visibility：Visible/Hidden
    statusNamesNote: '导入只到下架草稿：Status 填 Deactivated、Visibility 填 Hidden；上架须在后台改 Activated',
    freightNote: 'Package（包裹）信息目前不支持商品 CSV 导入导出，运费在后台物流设置；固定运费/模板名由适配器写入备注，买家须在后台建好物流方案',
    apiNotes: 'SHOPLINE 开放平台 API：须 SHOPLINE 店铺订阅＋开放平台应用授权；批量导入走后台 Products → Import → Bulk Import/Update，模板以后台下载为准',
  },
}
export function storefrontFieldMap(platform) {
  const p = SHOP_FRONT_FIELDS[platform]
  if (!p) throw new Error('未知自建店平台：' + platform)
  return p
}
