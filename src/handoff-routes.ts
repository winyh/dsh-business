import type { HandoffRoute } from './handoff-receive.js'

// Locally owned contract; no shared runtime package or cross-repository import.
export const handoffRoutes: Record<string, HandoffRoute> = {
  "opportunity-handoff": {
    "from": "dsh-idea",
    "nextTool": "business_model_review",
    "purpose": "引用机会证据，审查价值、收入假设和成本；不接管产品交付。",
    "text": [
      "source",
      "targetUser",
      "problem"
    ],
    "lists": [
      "evidence"
    ],
    "mode": "reference"
  },
  "product-sales-handoff": {
    "from": "dsh-product",
    "nextTool": "business_pricing_review",
    "purpose": "引用产品价值和交付边界，审查价格、成本与审批约束。",
    "text": [
      "source",
      "productName"
    ],
    "lists": [
      "valueEvidence",
      "proofPoints"
    ],
    "mode": "reference"
  }
}
