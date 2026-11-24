# 通用自动化插件（中途版本）

给通用商城模板加购的自动化工具：素材包半自动上新 + 批量自动上下架。
本版本为可测的中途版本：只做解析、提议、试跑、模拟导入与文件包，不连接任何真实数据库。
真实写库与定时轮询待 Sam 中途测试反馈后做终版。

## 三层结构（换场景不改代码）

- 引擎层（lib/）：只处理中间格式。中间格式分三层：共通必填（商品名、分类、价格、库存、主图、运费方式，缺了报错不导入）、规格（0-3 维，维名可配）、扩展袋（保质期、净含量、配料、功效、型号、重量等，目标无字段时写报告提醒，不整包失败）。
- 适配器层（adapters/）：每种场景一个，负责翻译。第一批：A 通用模板、B WANDER 本店、C 无后台文件版（只出标准商品表 + 改好名的图片包，不接数据库，上下架不适用）；D 抖音、E 淘宝、F 小红书三家平台适配器已做完整字段映射与接口定义（`implemented: false`），写入口未接通、调用即抛错，不返回假成功；G Shopify、H WooCommerce、I 有赞、J SHOPLINE 四家自建店通用适配器同样只做字段映射、写入口未接通。平台与店铺的真实上架须等接口接通。微盟未进：公开的商品导入字段资料不如这四家完整，且主打门店与小程序服务商模式，个人卖家常用度低于有赞；要加按同样格式补一条即可。
- 配置层（profiles/ + config/）：字段映射表、规格维度映射、图片规则、上下架规则模板、时区、目标连接配置。凭据只走配置文件，永不进代码与报告。

## 图片角色

主图、详情图、规格图、说明图四种角色，文件名规则可配（默认含 主图/main、详情/detail、规格图/spec、说明/尺码/info 标记判角色，无标记默认详情图）。尺码图只是说明图的一种。

## 上新流程（半自动）

1. 导入或扫描对方模板：`scan` 读表头提议映射，或 `discover` 读数据库字段列表 / API schema 提议映射；2. 人核对一次保存复用：`init-profile` 生成配置，人工核对后保存（核对时确认价格单位是元还是分，记进 `priceUnit`）；自己有商城网站、自己的分类时，也可以用 `generate-template` 从样表或字段清单生成自己的专用模板（JSON 文件，记事本就能改），改好分类、字段名、规格维与运费模板后用 `init-profile --from-template` 建配置，导入时用 `--template` 指定它；3. 之后拖包自动填：`dry-run` 先行（只解析、只出报告，不写库），确认无误再 `import-fake` 看草稿；4. 无后台场景用 `file-pack` 出标准商品表 + 图片改名计划。平台目标（抖音/淘宝/小红书）可用 `platform-fields <平台>` 看字段映射表，`dry-run` 看映射，`import-fake` 会直接拒绝（接口未接通）；自建店目标（Shopify/WooCommerce/有赞/SHOPLINE）用 `storefront-fields <平台>` 看字段映射表，同样 `dry-run` 看映射、`import-fake` 拒绝。

## 上下架引擎

批量设定（多选一次设定统一时间与售罄开关）、试跑、回滚、锁定、单次上限、总开关。轮询默认 5 分钟（不得小于 5 分钟，防烧资源点）。时间默认北京时间，存 UTC，不依赖浏览器时区。生效门控：只动处于可售状态的商品（状态名可配），未达标的跳过并点名提示。

## 命令

```
node bin/addon.mjs scan <模板.csv|json>
node bin/addon.mjs discover <字段文件.json> [--kind db|api] | discover <样表.csv|json> [--kind csv]
node bin/addon.mjs platform-fields <douyin|taobao|xiaohongshu>
node bin/addon.mjs storefront-fields <shopify|woocommerce|youzan|shopline>
node bin/addon.mjs generate-template <样表.csv|字段清单.json|字段清单.txt> --out <模板.json> [--fields "商品名,价格,..."] [--name X] [--target X]
node bin/addon.mjs init-profile <配置名> <模板> [--target generic-template|wander|file-only|douyin|taobao|xiaohongshu|shopify|woocommerce|youzan|shopline]
node bin/addon.mjs init-profile <配置名> --from-template <模板.json> [--target X]
node bin/addon.mjs dry-run <配置名> <清单.csv|json> [--images 图片目录] [--template 模板.json]
node bin/addon.mjs import-fake <配置名> <清单.csv|json> [--images 图片目录] [--template 模板.json]
node bin/addon.mjs file-pack <配置名> <清单.csv|json> [--images 图片目录] [--out 输出目录] [--template 模板.json]
node bin/addon.mjs schedule-plan <配置名> <状态.json> <规则.json> [--now YYYY-MM-DDTHH:mm]
node bin/addon.mjs schedule-demo <配置名> <状态.json> <规则.json> [--now YYYY-MM-DDTHH:mm]
node --test test/addon.test.mjs
```

## 界面版使用（v1.3.0）

不用终端也能用全部功能：本地网页界面，服务器只用 Node 内置 http 模块，零新依赖；界面是静态三件套（`ui/index.html` + `app.js` + `style.css`），无构建、无 CDN，离线能跑。

启动：Windows 双击 `start-ui.bat`；macOS/Linux 跑 `sh start-ui.sh`；或手动 `node bin/server.mjs`（默认端口 18771，`--port` 或 `PORT` 环境变量可改），再打开浏览器访问 `http://127.0.0.1:18771/`。详细步骤与常见问题见 `docs/ui-guide.md`；各目标的接入流程见 `docs/接入流程.md`（界面里也有“接入流程”页，内容一致）。

界面流程（顶部六个标签）：一、对字段（上传样表 → 看表头与提议映射，逐行可改 → 保存为配置；也可从模板建配置；配置列表可查看／编辑／删除）；二、试跑（选配置 → 上传清单、选图片文件名 → 出试跑报告，醒目写“只解析、只出报告，未写入任何目标（零写入）”）；三、看草稿和排程（import-fake 看模拟草稿；file-pack 下载标准商品表.csv＋图片改名计划.json；schedule-plan/demo 本地模拟）；模板管理（生成模板、下载模板 JSON、导入模板文件、文本框改模板＋校验后建配置）；参考（平台与自建店字段映射表查看）；接入流程（自有后台与第三方分开写：咱们这边已做好的部分、商家要准备的东西、还缺的第三方开口与接通后的步骤）。

文件上传不用 multipart：浏览器用 FileReader 把 CSV/JSON 读成文本，用 JSON `{filename, content}` 发给服务器；图片只需要文件名（引擎只按扩展名筛文件名、不读图片内容），界面用多文件选择、只传文件名数组。

接口（全部返回 JSON，错误也返回中文错误信息，与 CLI 命令 1:1 对应）：`POST /api/scan`、`POST /api/discover`、`GET /api/platform-fields`、`GET /api/storefront-fields`、`POST /api/generate-template`、`POST /api/templates/validate`、`GET/POST /api/profiles`、`GET/PUT/DELETE /api/profiles/:name`、`POST /api/dry-run`、`POST /api/import-fake`、`POST /api/file-pack`、`POST /api/schedule-plan`、`POST /api/schedule-demo`、`GET /api/demo`（内置演示数据，供“一键填入示例”）、`GET /api/onboarding`（接入流程数据，直接取各适配器的定义）。

验收见 `docs/ui-verification.md`。测试：`node --test test/server.test.mjs`（起临时端口服务器，调接口、用演示数据断言 dry-run 数字；配置写临时目录，不污染正式 `profiles/`）。

## 已知限制（中途版本）

- 不连接真实数据库；A/B 适配器只出翻译结果（payload），写库走终版。
- 模板只认 CSV 与 JSON；遇到 .xlsx/.xls 时 scan 与 init-profile 显式拒绝并提示换格式。
- 图片只按文件名归角色，不上传、不校验图片内容。
- 清单里的主图列值与图片目录里的同名主图文件只保留一条（按文件名去重）；不同名的两张主图仍各算一条。
- 规格单元格里的 `/` 是保留分隔符（组合列拆维用），规格取值本身不要含 `/`。
- 价格单位由配置 `priceUnit` 定死（yuan 元 / fen 分），核对映射时由人确认；旧配置缺此项时默认按元解析并警告一次。
- 规格维度超过 3 维时明确报错，不静默截断；未知列与未知规格维在试跑报告里点名，不静默丢。
- 运费模板由买家自己在后台设置好，工具往里填：配置里 `freightTemplates` 登记买家已建的模板（模板名、计费方式、区域与价格结构可配），`freightTemplateDefault` 是买家明确指定的默认模板名（空 = 不设默认）；模板方式导入时缺模板名即报错，提示买家先去后台建模板，不静默编默认值；dry-run 报告里有“运费映射”一节，逐件写清包邮 / 固定运费 / 模板名与计费价格。运费格留空也会报错。
- dry-run 报告里会点名平台必填缺失（如抖音/淘宝的品牌、运费模板），缺失不得上架；主图张数少于平台最少要求、SKU 超过平台上限时也会提醒。
- 抖音/淘宝/小红书适配器只有字段映射与接口定义，写入口未接通；上下架状态名已按公开资料核实（抖音：售卖中/已下架/审核中/审核不通过/封禁；淘宝：出售中/仓库中；小红书：售卖中/已下架/待审核/审核中/审核不通过）；抖音规格最多 3 类、SKU 上限 300，淘宝主图 5 张 800x800 与 SKU 上限 80 为卖家教程口径（官方未明文，以后台为准），小红书规格维上限与 SKU 上限仍待后台实测。每个适配器的 `connect()` 已把接口调用层的方法名与参数定死（createProduct/getProduct/setShelf/listProducts），接口一通只需把方法体换成真实请求；每个适配器还缺什么（入驻主体、授权方式等）写在 `REQUIRED_ONBOARDING` 里。

## 开源协议

本项目以 GNU Affero General Public License v3.0 开源，见 LICENSE 文件。
