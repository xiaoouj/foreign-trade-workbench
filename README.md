# Foreign Trade Workbench · 外贸工作台

面向外贸团队的自托管 CRM。原生 JavaScript 前端、Node.js HTTP 后端，默认以 JSON 文件存储，可选 MySQL / MariaDB。界面以中文为主，贸易单证支持中英文。

## 功能

- 客户与联系人、询盘商机、报价修改历史、订单及付款进度。
- 单证制作、产品与供应商、交付与财务记录。
- 任务日历、提醒、业绩报表、客户当地时间与汇率。
- 可选 OpenAI 兼容 AI 接口：文档识别、沟通摘要及业务辅助。
- PDF / Word / Excel / TXT / CSV 录入，报价明细与原文总额核对。
- 管理员与业务员权限、审计记录、可选邮箱与 WhatsApp 接入。

公开版不包含真实客户数据、公司银行账户、原部署配置或任何预设 API 密钥。首次启动为空业务库。3D 装箱求解模块不在本 MIT 发行版内；体积/载重计算及装箱单单证仍保留。

## 本地运行

需要 Node.js **22.16 或更新的 22.x/24.x 版本**。

```sh
npm ci
cp .env.example .env
# 编辑 .env，为 FTW_ADMIN_PASSWORD 设置自己的随机密码（至少 10 位）
npm start
```

浏览器访问 <http://localhost:4173>。初始用户名为 `admin`，密码为自己设置的 `FTW_ADMIN_PASSWORD`；该变量仅用于首次建库，不会重置已有用户。

业务数据、登录签名密钥、上传文件和 AI 配置保存在 `data/`。此目录与 `.env` 已加入忽略规则，请独立备份，勿提交到代码仓库。首次使用单证前，请填写自己的公司资料和收款账户；此版本没有内置卖方资料。

## Docker

```sh
cp .env.example .env
# 先填写 FTW_ADMIN_PASSWORD
docker compose up -d --build
```

默认仅绑定本机 `127.0.0.1:4173`，数据写入命名卷 `workbench-data`。需要局域网访问时明确设置 `FTW_BIND_ADDRESS`；公开网络部署应置于 HTTPS 反向代理和访问控制之后。升级使用 `docker compose up -d --build`；备份前核对命名卷，不要用 `down -v` 清除业务数据。

## AI 与外部服务

CRM 基础功能不需要 AI 密钥。在“AI 助手设置”中配置自己的 OpenAI 兼容地址、模型与密钥。使用 AI 时，提交的文档文字或业务上下文会发送到所配置的服务；也可使用自托管服务。

扫描图片 PDF 没有文本层时不能直接识别；请先 OCR。复杂 PDF 表格仍须核对产品名称、数量、单价、零价行和币种。金额提示仅辅助核对，不替代人工确认。汇率功能请求第三方汇率服务，不发送业务记录。

## 可选 MySQL / MariaDB

原生运行时设置 `FTW_STORAGE=mysql` 以及 `.env.example` 中的 `FTW_DB_*` 参数。请自行提供数据库和权限适当的数据库账号。数据库连接不可用时当前实现会回退到 JSON 模式，部署时应检查启动日志，避免误认为数据已写入数据库。默认 Docker 配置刻意只提供独立 JSON 部署。

`db/migrate.js` 是运维工具，运行前备份并阅读脚本；不要对唯一生产数据直接尝试迁移。

## 测试

```sh
npm test
```

自动化测试启动隔离的数据目录。浏览器测试需要自行安装 Playwright 和 Chromium；例如：

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/quotation-mapping.browser.cjs
```

可用 `FTW_PLAYWRIGHT_MODULE` / `FTW_CHROME` 指定现有安装。没有把任何真实报价文件或联系人打包为测试样本。

## 项目结构

- `server.js`：HTTP API、认证、权限与文件服务。
- `public/`：界面与浏览器业务逻辑。
- `db/`：JSON / MySQL 数据层与迁移工具。
- `doc-parser.js`：文件文字提取与 PDF 行整理。
- `sales-records.js`：销售字段与报价版本规则。
- `connectors/`：可选消息接入服务，需要独立配置。
- `tests/`：接口、业务规则及浏览器回归测试。

## 许可证与贡献

原创代码采用 [MIT](LICENSE)。依赖使用其各自许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。本项目是可自托管的初始公开版本，尚未经过独立安全审计。问题反馈请使用合成数据，不要在 issue、日志或截图中提交真实客户资料、访问令牌或密码。

参见 [脱敏范围](SANITIZATION.md)、[贡献指南](CONTRIBUTING.md) 和 [安全报告](SECURITY.md)。
