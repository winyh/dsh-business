# DSH 六插件协作契约

本文件是 `dsh-idea`、`dsh-product`、`dsh-geo`、`dsh-growth`、`dsh-sales` 与 `dsh-business` 的公开协作说明。它描述插件之间的职责边界、交接格式和反馈闭环；各仓库的 `docs/` 仍然是私有实现思路，不纳入发布包。

## 一句话定位

六个插件共同把一个“新发现”变成可交付、可获客、可成交、可复盘的业务闭环：

`新发现（新需求、新计划，也可以是其他外部变化） → dsh-idea → dsh-product → dsh-geo / dsh-growth → dsh-sales → 反馈回到 dsh-product / dsh-idea`

`dsh-business` 横向提供价值、商业模式、定价、成本、利润和报价边界，不替代任何阶段的执行职责。

## 职责与边界

| 插件 | 主责 | 接收 | 交付 | 明确不负责 |
| --- | --- | --- | --- | --- |
| `dsh-idea` | 外部信号、痛点、机会与最小验证实验 | 公开页面、访谈/评论/工单等证据 | `opportunity-handoff` | 产品范围、价格、销售跟进、增长统计 |
| `dsh-product` | 产品定义、可行性、交付门、PMF 与迭代 | 已有证据的机会交接、商业约束、行为数据 | 产品 Brief、范围/发布判断、`product-sales-handoff` | 重新做需求发现、定价、CRM 操作、营销执行 |
| `dsh-geo` | SEO/GEO/AEO、内容可发现性与内容变更审查 | 产品事实、用户语言、商业边界 | 审查、关键词/内容 Brief、预览写回 | 排名保证、登录提交、群发外链、网站工程 |
| `dsh-growth` | 获客、激活、留存、收入测量与增长实验 | 产品事件、渠道内容、销售和经营数据 | 指标契约、诊断、实验卡、经营复盘 | 产品决策、价格审批、销售跟单 |
| `dsh-sales` | 资格判断、商机推进、报价审查、成交、续费/扩单 | 产品销售交接、商业交接、客户/CRM 导出 | 销售审查、阶段老化、赢单/输单反馈 | 写入 CRM、联系客户、提交报价、折扣授权 |
| `dsh-business` | 商业模式、价值、定价、渠道经济性、盈利与报价边界 | 机会、产品、增长、销售结果 | 商业审查、`commercial-handoff`、商业计划 | 需求发现、产品交付、内容执行、销售跟进 |

## 标准交接链

1. `dsh-idea.idea_opportunity_handoff` 输出机会假设，必须保留来源、证据、最危险假设和验证实验；`partial` 只能进入验证，不是产品承诺。
2. `dsh-product` 消化机会并形成产品范围和 PMF 判断。只有在价值证据、Proof points、商业上下文和客户下一步动作齐备时，才输出可推进的 `product-sales-handoff`。
3. `dsh-business` 对产品和销售需要的价格、成本、利润、最低成交价和审批边界出具 `commercial-handoff`；它是计算事实与待审批项，不是自动授权。
4. `dsh-geo` 负责把已确认的产品和商业事实转成可发现、可引用的内容；`dsh-growth` 负责定义和分析获客、激活、留存、收入及实验指标。
5. `dsh-sales` 负责人工销售执行的判断与复盘，不写 CRM、不发送消息、不替代折扣审批。
6. 成交、输单、续费、内容表现和增长数据形成反馈：产品问题回 `dsh-product`，新的用户问题、市场变化或经营机会统一回 `dsh-idea`，统一称为“新发现”。

## 共同结果与工件格式

工具结果使用统一外层：

```json
{
  "schemaVersion": "1.0",
  "ok": true,
  "data": {},
  "warnings": [],
  "assumptions": [],
  "lineage": [{ "source": "path-or-url", "fields": ["field"] }],
  "nextActions": []
}
```

跨插件 Markdown/JSON 工件至少包含：`schemaVersion`、`artifactId`、`artifactType`、生成时间、来源、负责人（如适用）、证据/警告、下一步，以及 `handoffFrom` / `handoffTo`（如适用）。下游插件必须检查 `artifactType`、来源/目标和关键证据，不得把缺失字段推断成结论。

## 防冲突规则

- 同一问题只能有一个主责插件；其他插件只能提供输入、约束或反馈。
- “事实、假设、决定、授权”分开写。插件可以生成审查和建议，不能代替用户审批、客户沟通或外部提交。
- 所有写回默认先预览，再使用版本保护写入；只允许写入用户配置的根目录。
- `docs/` 是本地私有思路文档，必须被 Git 忽略，不能进入提交、发布包或公开 README。
- 不增加第七个插件：公共协作契约由本文件和各插件的公开类型/结果结构承载。

## English summary

The six plugins form one operating loop: **new discovery (new need, new plan, or another external change) → opportunity discovery → product delivery → discoverability and growth → monetization execution → feedback**. `dsh-business` is the cross-cutting commercial strategy layer. Each handoff is evidence-bound, versioned and guarded; plugins do not impersonate approvals, CRM writes, customer outreach or external submissions. The `docs/` directories remain private and are excluded from Git and published packages.
