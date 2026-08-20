---
name: business-strategy
description: Use dsh-business for business model, monetization, pricing architecture, channel economics, profitability, elevator pitches and evidence-aware business plans.
---

# 商业策略与商业化

`dsh-business` 位于 `dsh-idea` / `dsh-product` 和 `dsh-growth` 之间：它把机会、产品结果和增长数据连接成商业决策。已确认的商业条件进入客户成交推进时交给 `dsh-sales`。它不替代需求发现、产品交付、销售推进或增长执行。

## 工具边界

- `business_model_review`：检查客户、价值、收入来源、收费模式、渠道、成本和证据是否闭环；
- `business_pricing_review`：检查标价、供货价、成交价、最低交易价、渠道费率和贡献毛利率；
- `business_profitability_review`：计算收入、变动成本、贡献利润、总成本和利润，不冒充完整会计净利润；
- `business_elevator_pitch`：生成 30 秒、60 秒和 2 分钟的 Pitch；
- `business_plan`：生成商业计划，区分事实、假设、缺口和下一步验证。

## 定价与渠道原则

不要用一个价格覆盖所有渠道。区分：

- 标价；
- 供货价；
- 实际成交价；
- 促销价；
- 最低交易边界；
- 产品成本；
- 渠道佣金、履约和其他单位成本。

`commissionRate`、`discountRate` 和 `targetContributionMargin` 使用百分比输入，例如 `15` 表示 15%。出现负贡献、低于最低交易价或价格口径冲突时，先暂停扩大投入并复核价盘。

## 决策原则

- 信息不足得到 `hold` 或 `partial`，不等于商业模式已经失败；
- 只有明确的反证才得到 `reject`；
- Pitch 不得凭空添加客户、收入、留存或融资证据；
- 商业计划是可验证的经营假设，不是对未来结果的保证。

## 上下游协作

- 从 `dsh-idea` 接收机会、目标用户和问题证据；
- 从 `dsh-product` 接收产品结果、PMF 和产品决策门；
- 将已验证的商业模型、价格边界和利润护栏交给 `dsh-sales` 做报价与成交审查；
- 将已验证的商业模型、主指标和利润护栏交给 `dsh-growth` 做规模化增长。
