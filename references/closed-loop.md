# dsh-business：闭环接收与反馈使用契约

这是公开使用说明，不包含私有 `docs/` 实现思路。各插件独立维护自己的接收约定，不引入第七个插件或共享运行时契约包。

## 本插件的接收入口

工具：`business_handoff_receive`。只读输入，返回回执；不执行下一步动作、不自动写文件，也不触发外部系统。

| 输入工件 | 来源 | 接收方式 | 接收后的下一工具 |
| --- | --- | --- | --- |
| `opportunity-handoff` | `dsh-idea` | 横向引用，不接管原接收职责 | `business_model_review` |
| `product-sales-handoff` | `dsh-product` | 横向引用，不接管原接收职责 | `business_pricing_review` |

关键业务字段：

- `opportunity-handoff`：`source`、`targetUser`、`problem`、`evidence`。引用机会证据，审查价值、收入假设和成本；不接管产品交付。
- `product-sales-handoff`：`source`、`productName`、`valueEvidence`、`proofPoints`。引用产品价值和交付边界，审查价格、成本与审批约束。

## 每次交接都绑定同一事项

1. 先运行生产工具。保留完整 JSON 结果或其原始 `data`，不要仅复制 Markdown 摘要或被截断的显示文本。
2. 调用本插件接收工具，提供 `artifactJson`（完整 JSON 字符串）、`initiativeId`（跨插件共用的事项 ID）、`owner`、`action`、`dueDate`（有效的未来 ISO 日期或时间）。
3. 检查 `status`、`issues`、`missing`、`warnings`。回执保留 `sourceArtifactId`、`sourceContentHash`、`receivedBy`、`context` 和下一工具。
4. 负责人完成动作后，产生本阶段的新输出；将原工件、回执和结果保存在用户批准的位置，再交给下游。这些工具不会自动替你保存文件或执行任务。
5. 对完整六插件流程，将所有原件和回执交给 `business_loop_review`，并指定同一 `initiativeId`。可以直接传入 JSON 数组，或保存为根目录下的 JSON/JSONL 再扫描。Markdown 标题或 frontmatter 不能代替完整 JSON 证据。

参数结构示例（占位符需要替换，不是可直接运行的业务工件）：

```json
{
  "artifactJson": "<生产工具返回的完整 JSON 字符串>",
  "initiativeId": "report-export-001",
  "owner": "<实际负责人>",
  "action": "<本插件下一步的具体动作>",
  "dueDate": "<未来 ISO 日期或时间>"
}
```

事项 ID 是用户指定的归属，不是插件自动识别的客户或项目。不要给不相关材料填同一个 ID 来凑齐流程。横向引用仅用于商业约束分析，不改变原件的目标插件。

## 状态不能混用

- `accepted`：格式、内容一致性、路由、必需字段和行动归属通过接收检查，允许继续审查。**不是**需求验证、发布批准、价格授权、动作完成或成交。
- `needs-validation`：字段、负责人、日期或上游验证不足；补齐后重新生成并接收，不能直接改状态。
- `blocked`：来源失败、目标错误、过期、内容变更或契约不支持；停止推进，回到来源处理。
- 回执永远声明 `approvalGranted=false`、`completionClaimed=false`。原材料的警告和审批约束不会因接收而消失。

## 本阶段的落地重点

`business_loop_review` 现在必须指定 `initiativeId`。传入本事项的原工件与接收回执，或扫描项目根目录中的 JSON/JSONL。它检查 7 个关口：机会接收、商业约束、产品销售交接、公开内容、实际增长观测、反馈接收、复验结果回传。相同 ID 的重复材料只计算一次，冲突版本必须先澄清。`coordinationClosed=true` 仅表示协作反馈链闭合；`businessImpact=observed-not-attributed` 只表示观察到了变化，不表示增长或因果。

## 内容与版本保护

新版工件使用 `hashVersion=sha256-v2`，校验的是传输内容一致性，**不是数字签名、来源身份认证或事实真实性证明**。修改正文、警告、有效期或嵌套字段会使原校验值失效；请重新运行来源工具并让下游重新接收，不能手动更新 hash 冒充核验。

旧版工件仍可识别，但没有可验证的版本校验时只能作为待核验材料，不会自动变成 ready。相同输入的工件 ID 不用于授权；复盘同时绑定内容版本。工件生成时间与有效期也不等于底层业务证据已经更新。

`docs/` 保持私有且不打包。原始客户数据、联系人、私有成本或研究正文不能因流程需要而被公开。事实、假设、执行结果、业务效果分别记录；外部操作仍需单独授权。

## 验证与维护

在本仓库运行 `pnpm run verify`，包含单元测试、构建、打包检查和真实 DSH 服务下的运行验证。维护者同时检出并构建六个同级仓库后，可在 `dsh-business` 运行 `node scripts/validate-suite.mjs`：它以模拟数据串联实际工具，检查正常链路及错误路由、内容变化、缺失来源、重复测量和失败结果。不会调用模型、网络服务或用户的 DSH profile。独立仓库的 verify 不依赖其他仓库。

## English usage summary

Use `business_handoff_receive` with the original artifact JSON, a shared initiative ID, an owner, a concrete next action and an ISO deadline. The routing table above defines supported inputs and the next tool. Reference mode supports cross-cutting commercial review; it never takes over the original recipient's responsibilities.

An accepted receipt acknowledges a review assignment, not authorization, completion, validated demand or commercial success. Preserve original artifacts and receipts together. Missing evidence requires validation; failed, stale, altered or misrouted inputs block progression. Versioned checksums detect transport changes, not forged identity or false evidence.

For the full loop, pass originals and receipts for one initiative to `business_loop_review`. Actual growth observations and a source-linked product recheck acknowledged by sales are required; document presence alone cannot close the loop. Observed metric changes are not causal proof. Private `docs/` and customer data remain private. Tools do not persist receipts or execute next actions automatically.
