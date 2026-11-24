# 界面版验收记录（v1.3.0）

验收时间：2026-11-22。验收方法：自动化测试＋真服务 curl 全接口＋CLI 对账。结论：全部通过。

## 1. 自动化测试

- `node --test test/addon.test.mjs`：37 个通过，0 失败（原测试一个没动、一个没少）。
- `node --test test/server.test.mjs`：12 个通过，0 失败。内容：首页返回界面 HTML（含 v1.3.0 与“零写入”）；`/api/demo` 返回四份演示内容；scan 提议映射与 CLI 一致；建配置；演示数据 dry-run 数字断言；import-fake 通用模板出草稿 0 → 3 件；抖音目标 403 明确拒绝；file-pack；schedule-demo 回滚一致；生成模板＋校验；平台字段表与 onboarding 数据；PUT 改价格单位；非法配置名拒绝。
- 合计：49 个通过，0 失败。
- 测试里配置写临时目录（`ADDON_PROFILES_DIR`），不污染正式 `profiles/`。

## 2. 真服务全接口跑一遍（端口 18771）

`node bin/server.mjs` 启动后，用 curl／Python 逐个调接口（演示数据来自 `sam-test/`，配置“测试店”用对方商城样表建，目标 generic-template）：

| 接口 | 结果 |
|---|---|
| GET / | 200，含 v1.3.0；app.js、style.css 正常返回 |
| GET /api/demo | 200：清单 3 行、样表、状态 3 件、规则 1 条、图片文件名 5 个 |
| POST /api/scan | 200：产品名称→商品名，缺失必填映射无 |
| POST /api/discover（csv） | 200：字段 10 个 |
| GET /api/platform-fields?platform=douyin | 200：抖音（抖店），必填 7 项 |
| GET /api/storefront-fields?platform=shopify | 200：Shopify（自建独立站） |
| POST /api/generate-template（只给 3 个字段名） | 200：草稿 9 个字段；validationErrors 如实报缺分类／主图／运费方式来源列 |
| POST /api/templates/validate（无效草稿） | 200，ok:false，逐条报校验错误（校验不通过是正常返回，用 ok 字段区分） |
| GET /api/profiles | 200：对方美妆店、测试店 |
| POST /api/profiles（扫样表建“验收店”） | 200 |
| GET /api/profiles/验收店 | 200 |
| PUT /api/profiles/验收店（价格单位改分再改回元） | 200，两次都生效 |
| POST /api/dry-run | 200：见第 3 节 |
| POST /api/import-fake（测试店） | 200：草稿 0 → 3 件，全为 stage=pool、review=pending、onShelf=false |
| POST /api/import-fake（抖音目标） | 403：“模拟导入拒绝：douyin 平台／店铺接口未接通（只做了字段映射与接口定义），先用 dry-run 看映射，写入口待接通接口后实现” |
| POST /api/file-pack | 200：3 件；标准商品表.csv 首行“商品名,分类,价格分,库存,主图,运费方式,固定运费分,描述”；图片改名计划 8 条 |
| POST /api/schedule-plan | 200：动作 2 个，跳过 1 个，报警 0 条；计划时间 2026/11/20 10:00 |
| POST /api/schedule-demo | 200：执行前 p1:false p2:false p3:true；执行后 p1:true p2:false p3:false；回滚后与执行前一致；回滚一致：是 |
| GET /api/onboarding | 200：自有后台 3 家、第三方 7 家；抖音 REQUIRED_ONBOARDING 4 项，方法 createProduct／getProduct／setShelf／listProducts |
| DELETE /api/profiles/验收店、抖店验收 | 200，已删 |
| POST /api/scan（.xlsx） | 400：“扫描拒绝：模板不支持 Excel（.xlsx/.xls）：请另存为 CSV 或 JSON 再扫描” |

## 3. 演示数据 dry-run 实际输出（与 CLI 对账）

API（`POST /api/dry-run`，配置“测试店”，清单 `sam-test/material-pack/清单.csv`，图片 5 个文件名）：

- 解析：3 件商品，错误 0 条，提醒共 4 条（解析提醒 0 条，适配提醒 4 条）
- 运费映射：纯棉T恤：包邮；帆布手提袋：固定运费 ¥8.00；手工香皂：包邮
- 首件翻译结果：纯棉T恤，颜色 白／黑 × 尺码 M／L（4 个规格）
- 结论：只解析、只出报告，未写入任何目标（零写入）。

CLI 对照（`node bin/addon.mjs dry-run 测试店 sam-test/material-pack/清单.csv --images sam-test/material-pack/images`）：首行逐字相同“解析：3 件商品，错误 0 条，提醒共 4 条（解析提醒 0 条，适配提醒 4 条）”；运费三条逐字相同；结论逐字相同。4 条适配提醒为：固定运费折算 1 条、手工香皂扩展字段 2 条（保质期 18 个月、净含量 100g）、说明图并入详情图 1 条。

file-pack 对照：CLI 与 API 的图片改名计划都是 8 条（3 个主图列值＋5 个图片文件），首条 `001_main_tee-main.jpg`。

schedule-demo 对照：CLI（`sam-test/测试步骤.md` 第 6 步）与 API 结果一致：执行前 p1:false p2:false p3:true；执行后 p1:true p2:false p3:false；回滚一致：是。

验收中修正过的两处测试期望（均以 CLI 实测为准，不是以猜测写）：提醒拆分原写解析 1 条／适配 3 条，CLI 实测为解析 0 条／适配 4 条，已按实测改；改名计划原写 5 条，CLI 实测 8 条（主图列值也算图片），已按实测改。

## 4. 启动脚本

- `start-ui.sh`（Linux 实测）：`PORT=18772 timeout 12 sh start-ui.sh`，服务在 18772 起，`curl http://127.0.0.1:18772/` 返回 200，日志打印启动地址；超时后进程退出。
- `start-ui.bat`：Linux 跑不了，只做了逐行检查（`cd /d "%~dp0"`、`where node` 判空、`start "automation-ui" /min node bin\server.mjs` 后台起服务、`timeout /t 2` 后打开浏览器、路径全用 Windows 写法）。Sam 在 Windows 上双击后如打不开，把窗口里的报错原样发回来。

## 5. 备注

- 验收用的“测试店”配置（CLI 对照时 `init-profile` 生成）与“验收店”“抖店验收”配置已在验收后删除，`profiles/` 只剩原来的 `对方美妆店.json`。
- 界面 JS（`ui/app.js`）过 `node --check`；服务器 `bin/server.mjs` 过 `node --check`。
- 未改动的文件：`lib/`、`adapters/`、`bin/addon.mjs`、`test/addon.test.mjs` 全部没动（git 状态可查）；只改了 `README.md`（追加“界面版使用”一节），其余全是新文件。
