# dsh-business

English | [中文](./README.zh.md)

商业策略与商业化插件，覆盖商业模式、定价与渠道价盘、盈利能力、电梯 Pitch 和商业计划。

Evidence-backed business strategy and commercialization tools for business models, pricing architecture, channel economics, profitability, elevator pitches and business plans.

Public six-plugin collaboration contract: [SUITE.md](https://github.com/winyh/dsh-business/blob/main/SUITE.md).

## DSH compatibility and installation

Closed-loop handoff guide: [owned receipts, evidence gates and feedback](./references/closed-loop.md). Start cross-plugin work with `business_handoff_receive`; an accepted receipt is not approval or completion.

Tested against DeepSeek Harness **0.1.5-rc.2**, the npm `latest` channel checked on 2026-09-22, with Cordis 4.0.2. Node.js must satisfy `^22.19.0 || >=24.0.0`. DSH peer packages are pinned to the tested version; other release channels need a fresh compatibility check.

```sh
npm install -g @deepseek-ai/dsh@0.1.5-rc.2
dsh --version
dsh plugin --profile web add github:winyh/dsh-business
dsh --profile web --dump-config
dsh web
```

Install into the profile you actually launch: `web` for `dsh web`, or replace it consistently with your custom profile name. Installing into `default` does not enable the plugin in `web`. Restart the running profile after an update.

A GitHub source installation uses `prepare` to build the entry point. If pnpm blocks it, add the exact package key printed by pnpm to that profile's `pnpm-workspace.yaml` under `allowBuilds` and repeat the installation after reviewing the source. Pin a reviewed Git commit for reproducibility. A built tarball from `pnpm pack` can instead be installed with `dsh plugin --profile web add ./package.tgz`.

The profile supplies `tools` and `fs`. Private `docs/` files remain excluded from Git and package contents.

For maintainers, run `pnpm install --frozen-lockfile` and `pnpm run verify`. Verification includes type checking, lint, unit tests, build, package checks and `plugin:runtime:validate`: a keyless Cordis Loader test of the built plugin with real DSH services, model-visible tools, file reads, argument/output validation, cancellation and unload cleanup.

## 协作可靠与业务闭环

`business_artifact_index` 扫描项目中的结构化工件，`business_artifact_review` 校验交接工件的稳定 ID、内容指纹和有效期；`business_loop_review` 检查新发现、产品、商业、增长、可发现性和销售反馈是否形成可执行闭环。

`business_artifact_index` scans local structured artifacts, `business_artifact_review` validates handoff IDs, content fingerprints and freshness; `business_loop_review` checks whether discovery, product, commercial, growth, discoverability and sales feedback gates form an actionable loop.

## Plugin Positioning: Cross-Cutting Commercial Strategy Layer

`dsh-business` is not the execution plugin for the monetization stage. It is the commercial strategy layer that spans demand, product, marketing and monetization, turning customer value, product capability, target segments and operating results into an explainable business model, pricing architecture and path to profitability.

- **Owns:** Business models, value propositions, product/package design, pricing architecture, channel economics, contribution margin, profitability, elevator pitches and business plans.
- **Across the flow:** Evaluates opportunity value in the demand stage, constrains value and scope in the product stage, defines positioning and channel economics in marketing, and sets pricing, offer and profit boundaries in monetization.
- **Inputs:** Opportunities and target users from `dsh-idea`, product scope and PMF evidence from `dsh-product`, acquisition/conversion data from `dsh-geo` and `dsh-growth`, and offer/close feedback from `dsh-sales`.
- **Outputs:** Business model canvases, pricing and packaging recommendations, channel unit economics, profitability hypotheses, business plans and value/offer boundaries for sales.
- **Does not own:** Demand discovery, product delivery, marketing content execution, sales follow-up or CRM operations. It provides commercial judgment and rules; the relevant plugin or team executes them.

## Positioning Architecture: Commercial Strategy Layer + Four-Stage Core Flow

The six plugins work together to turn a real demand signal into a deliverable product, reach target customers through marketing, and use monetization results to drive product iteration or discover new opportunities.

```mermaid
flowchart TB
    S["dsh-business<br/>Commercial strategy layer<br/>Value · model · pricing · profit"]

    subgraph MAIN["Four-stage core flow"]
        direction LR
        A["1. Demand<br/>dsh-idea"] --> B["2. Product<br/>dsh-product"]
        B --> C["3. Marketing<br/>dsh-geo + dsh-growth"]
        C --> D["4. Monetization execution<br/>dsh-sales"]
    end

    S -. "Sets commercial direction and guardrails" .-> A
    D --> R["Feedback<br/>Deals · renewals · revenue · cost"]
    R -->|Product iteration| B
    R -->|New discovery| A

    classDef strategy fill:#FFF4D6,stroke:#B7791F,color:#5C4500
    classDef stage fill:#E8F1FF,stroke:#3366CC,color:#173A7A
    classDef feedback fill:#E8F7EE,stroke:#2F855A,color:#1C4532
    class S strategy
    class A,B,C,D stage
    class R feedback
```

`dsh-business` answers: **“Why will customers buy, what should we sell, how should we price it, and is each deal becoming healthier?”** It does not occupy one stage; it provides commercial judgment across all four stages. Monetization data, pricing objections, discounts, losses and renewals feed back to [dsh-product](../dsh-product/README.md) for product iteration and to [dsh-idea](../dsh-idea/README.md) for new demand discovery.

## Collaboration Handoffs

| Business touchpoint | What this plugin provides | Collaborators |
| --- | --- | --- |
| Demand evaluation | Turn an opportunity into value propositions, revenue hypotheses and business model options | [dsh-idea](../dsh-idea/README.md), [dsh-product](../dsh-product/README.md) |
| Product definition | Design packaging, price ladders, cost/margin targets and commercialization gates | [dsh-product](../dsh-product/README.md) |
| Marketing design | Define positioning, value communication, channel choices and acquisition economics | [dsh-geo](../dsh-geo/README.md), [dsh-growth](../dsh-growth/README.md) |
| Monetization execution | Provide offer, discount, profit boundaries and sales strategy | [dsh-sales](../dsh-sales/README.md) |
| Results feedback | Adjust strategy using close, loss, renewal and unit-economics evidence | [dsh-product](../dsh-product/README.md), [dsh-idea](../dsh-idea/README.md) |

All business tool results use the shared result envelope with `ok`, `data`, `warnings`, `assumptions`, `lineage` and `nextActions`. The `lineage` field is populated from source-backed evidence when available, so commercial decisions can be traced back to the supplied material.

`business_commercial_handoff` turns a pricing review and optional profitability review into a versioned `commercial-handoff` for `dsh-sales` or `dsh-product`. It reports calculated facts and required approvals only; it never approves a price, discount or revenue commitment.

## Plugin Navigation

| Plugin | Clear responsibility | Direct link |
| --- | --- | --- |
| dsh-idea | External opportunities, demand signals, candidate directions and smallest useful tests | [README](../dsh-idea/README.md) |
| dsh-product | Product definition, POC/MVP, release gates and PMF | [README](../dsh-product/README.md) |
| dsh-business | Cross-cutting commercial strategy, value, pricing and profitability (this plugin) | [README](./README.md) |
| dsh-sales | Monetization execution: qualification, deal progression, closing, expansion and renewal | [README](../dsh-sales/README.md) |
| dsh-growth | Acquisition, activation, retention, revenue analysis and growth experiments | [README](../dsh-growth/README.md) |
| dsh-geo | SEO/GEO/AEO, content production and search/answer-engine discoverability | [README](../dsh-geo/README.md) |

## Scope

Start here when the question is about how to make money, what to package, whether pricing is sound, which channels are profitable, or how to build a business plan. For “is this worth doing?”, start with [dsh-idea](../dsh-idea/README.md); for “what product should we build and how do we validate PMF?”, use [dsh-product](../dsh-product/README.md); for “how do we build traffic and revenue?”, use [dsh-growth](../dsh-growth/README.md).
