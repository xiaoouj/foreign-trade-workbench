外贸工作台 CRM · WorkBuddy MCP 同事试用版

一、获取文件和个人配置
1. 登录 http://localhost:4173/，打开“询盘管理”。
2. 点击“MCP 接入”，下载同事试用包，解压到 C:\FTW-MCP。
3. 点击“生成个人接入配置”，复制生成的 JSON。凭据绑定当前 CRM 账号，有效期 30 天。
4. 在 WorkBuddy 的连接器 / 自定义 MCP 中添加配置；保留已有 MCP 服务，只新增 ftw-inquiry-drafts 这一项。
5. “command”使用 node；建议 Node.js 22。配置包含 runtime 选项，具体运行时支持取决于 WorkBuddy 版本。若提示找不到 node，请安装 Node.js 22 或把 command 改成 node.exe 的完整路径。
6. 若文件解压到其他目录，修改 args 中的 ftw-crm-mcp.cjs 路径。保持同局域网并能打开 CRM 地址。

二、先检查连接
在 WorkBuddy 中输入：
“请调用 crm_check_connection，告诉我绑定的 CRM 账号，以及可用工具。不要创建正式询盘。”

应返回你的 CRM 姓名及草稿能力。凭据失效可在 CRM 的 MCP 接入里撤销旧凭据、生成新的配置。

三、测试草稿、去重与查询
把本包 test-draft.json 的内容交给 WorkBuddy，并输入：
“请使用 crm_create_inquiry_draft 保存这条测试草稿。原文完整传入，不改来源编号，不编造其他信息。然后用相同参数再次调用，核对第二次返回 duplicate=true、草稿编号相同。最后调用 crm_get_inquiry_draft，展示已保存的原文和 CRM 核对链接。”

测试应出现 manual-test 来源及“测试”标识。测试草稿不会进入正式询盘，无法确认登记或关联正式询盘。

四、测试补充字段
“请先读取这条草稿的当前 version，再用 crm_update_inquiry_draft 把 model 补充为‘长度 6m，宽度 800mm’，不改原文、来源或负责人。再次读取核对字段。”

遇到“草稿已变化”时重新读取，不猜版本。来源编号相同但原文变化时，CRM 保留原始内容和后续内容，不覆盖人工确认的字段。

五、到 CRM 核对
打开返回的 reviewUrl，使用本人 CRM 账号登录。也可在“询盘管理 → 草稿箱”找到记录。
可核对原文、保存字段、查看缺失项，并填写“测试完成”后标记为非询盘。
真实来源草稿可核对后登记新询盘或关联已有询盘；客户相同不等于询盘相同，必须核对具体需求。

六、真实阿里资料接入
当前版本已准备好 CRM 接入端，未自动配置阿里采集任务。
同事需用其已有阿里工具获取真实记录，再推送完整原文及稳定源编号。source 使用 alibaba-mc 或 alibaba-im，accountId 使用真实卖家账号，sourceRecordId 使用真实询盘/消息事件编号。IM 不只用长期复用的 conversationId。
sourceSentAt 使用真实发送日期或带时区 ISO 时间，未知留空；fields 是待核对候选，预算/币种未知留空。
不能把测试来源改成真实来源来绕过测试限制；测试用例保持 manual-test。

工具清单：
crm_check_connection：检查身份及连接
crm_create_inquiry_draft：保存草稿
crm_list_inquiry_drafts：查询本人草稿
crm_get_inquiry_draft：读取原文、版本及核对链接
crm_update_inquiry_draft：补充待确认字段

这个试用版的正式确认入口在 CRM。WorkBuddy 内嵌的确认卡片尚未启用，需在 Windows 客户端完成界面和身份兼容性验证后再接入。
试用反馈建议记录：WorkBuddy 版本、连接成功与否、草稿编号、重复提交结果、原文是否完整、核对页是否可用；不要把个人接入凭据发进聊天或反馈文本。

官方接入方式：https://open.workbuddy.cn/docs/connector
