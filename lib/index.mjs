import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createHash } from "node:crypto";
import { join } from "node:path";

//#region src/artifact-integrity.ts
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
	return value;
}
function integrityHash(value) {
	const payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contentHash"));
	return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}
function validDate(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
	const day = value.slice(0, 10);
	const parsed = Date.parse(day + "T00:00:00Z");
	return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
}

//#endregion
//#region src/artifacts.ts
const artifactDomain = "dsh-business";
function normalized(value) {
	if (Array.isArray(value)) return value.map(normalized);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => ![
		"artifactId",
		"generatedAt",
		"capturedAt",
		"markdown",
		"warnings",
		"nextActions"
	].includes(key)).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalized(item)]));
	return value;
}
function contentHash(value) {
	const raw = typeof value === "string" ? value : JSON.stringify(normalized(value));
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}
function slug(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "artifact";
}
function createArtifactId(value) {
	return `${artifactDomain}-${slug(typeof value.artifactType === "string" ? value.artifactType : "artifact")}-${contentHash(value).slice(0, 12)}`;
}
function addDays(iso, days) {
	const date = new Date(iso);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString();
}
function attachArtifactMetadata(value, options = {}) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const record$1 = value;
	if (typeof record$1.artifactType !== "string" || !record$1.artifactType.trim()) return value;
	if (record$1.hashVersion === "sha256-v2") return value;
	const generatedAt = typeof record$1.generatedAt === "string" && record$1.generatedAt ? record$1.generatedAt : (/* @__PURE__ */ new Date()).toISOString();
	const result = {
		...record$1,
		schemaVersion: typeof record$1.schemaVersion === "string" ? record$1.schemaVersion : "1.0",
		artifactId: typeof record$1.artifactId === "string" && record$1.artifactId ? record$1.artifactId : createArtifactId(record$1),
		generatedAt,
		capturedAt: typeof record$1.capturedAt === "string" ? record$1.capturedAt : generatedAt,
		revision: typeof record$1.revision === "number" ? record$1.revision : 1,
		hashVersion: "sha256-v2"
	};
	if (options.sourceHash) result.sourceHash = options.sourceHash;
	if (options.staleAfterDays !== void 0 && !record$1.staleAfter && validDate(generatedAt)) result.staleAfter = addDays(generatedAt, options.staleAfterDays);
	const serialized = JSON.parse(JSON.stringify(result));
	serialized.contentHash = integrityHash(serialized);
	return serialized;
}
function reviewArtifact(value, expectedType) {
	const issues = [];
	const warnings = [];
	if (!value || typeof value !== "object" || Array.isArray(value)) return {
		status: "blocked",
		issues: ["工件必须是 JSON object。"],
		warnings,
		nextActions: ["传入插件实际生成的 JSON 工件，而不是 Markdown 展示文本。"]
	};
	const record$1 = value;
	const artifactType$1 = typeof record$1.artifactType === "string" ? record$1.artifactType : void 0;
	const artifactId = typeof record$1.artifactId === "string" ? record$1.artifactId : void 0;
	const sourceHash = typeof record$1.sourceHash === "string" ? record$1.sourceHash : void 0;
	const artifactContentHash = typeof record$1.contentHash === "string" ? record$1.contentHash : void 0;
	const staleAfter = typeof record$1.staleAfter === "string" ? record$1.staleAfter : void 0;
	if (record$1.schemaVersion !== "1.0") issues.push("schemaVersion 必须为 1.0。");
	if (!artifactId?.trim()) issues.push("缺少稳定 artifactId。");
	if (!artifactType$1?.trim()) issues.push("缺少 artifactType。");
	if (expectedType && artifactType$1 !== expectedType) issues.push(`artifactType 必须为 ${expectedType}。`);
	if (!validDate(record$1.generatedAt)) issues.push("generatedAt 必须是有效 ISO 日期或时间。");
	else if (Date.parse(record$1.generatedAt) > Date.now() + 3e5) issues.push("generatedAt 不能是未来时间。");
	if (record$1.staleAfter !== void 0 && !validDate(record$1.staleAfter)) issues.push("staleAfter 必须是有效 ISO 日期或时间。");
	if (validDate(staleAfter) && validDate(record$1.generatedAt) && Date.parse(staleAfter) < Date.parse(record$1.generatedAt)) issues.push("staleAfter 不能早于 generatedAt。");
	if (record$1.hashVersion === "sha256-v2") {
		if (!artifactContentHash || artifactContentHash !== integrityHash(record$1)) issues.push("contentHash 不匹配：内容已变化，请重新生成工件并重新交接。");
	} else if (record$1.hashVersion !== void 0) issues.push("不支持的 hashVersion。");
	else warnings.push("旧版或缺少内容校验版本；请由来源插件重新生成，不能自动视为已验证。");
	if (!staleAfter) warnings.push("缺少 staleAfter，无法自动判断证据是否过期。");
	const stale = validDate(staleAfter) && Date.parse(staleAfter) <= Date.now();
	if (stale) warnings.push(`工件已过期：${staleAfter}。`);
	const status = issues.length > 0 ? "blocked" : stale ? "stale" : warnings.length > 0 ? "partial" : "ready";
	return {
		status,
		issues,
		warnings,
		artifactId,
		artifactType: artifactType$1,
		sourceHash,
		contentHash: artifactContentHash,
		staleAfter,
		nextActions: status === "ready" ? ["格式、内容一致性和有效期检查通过；仍需由接收插件审查业务证据与授权边界。"] : ["回到来源插件补齐或更新工件，再交接；不要直接修改 hash 或有效期。"]
	};
}
function scalar(value) {
	const trimmed = value.trim();
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"") || trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	return trimmed;
}
function candidatesFromText(path, content) {
	const extension = path.toLowerCase().slice(path.lastIndexOf("."));
	if ([
		".json",
		".jsonl",
		".ndjson"
	].includes(extension)) {
		const lines = extension === ".json" ? [content] : content.split(/\r?\n/).filter(Boolean);
		const values = [];
		for (const line of lines) try {
			const parsed = JSON.parse(line);
			if (Array.isArray(parsed)) values.push(...parsed);
			else values.push(parsed);
		} catch {}
		return values;
	}
	const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return [];
	const frontmatter$1 = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
		const key = field?.[1];
		const value = field?.[2];
		if (key && value !== void 0) frontmatter$1[key] = scalar(value);
	}
	return frontmatter$1.artifactType ? [frontmatter$1] : [];
}
async function indexArtifacts(fs, root, maxFiles, maxTextChars, signal, includeValues = false) {
	const artifacts = [];
	const warnings = [];
	let scannedFiles = 0;
	const walk = async (path, target) => {
		if (scannedFiles >= maxFiles) return;
		let entries;
		try {
			entries = await fs.listDir(target, signal);
		} catch (error) {
			warnings.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		for (const entry of entries) {
			if (scannedFiles >= maxFiles) break;
			if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "docs" || entry.name === "lib" || entry.name === "coverage" || entry.name.startsWith(".")) continue;
			const child = join(path, entry.name);
			if (entry.type === "directory") {
				await walk(child, entry.target);
				continue;
			}
			const extension = entry.name.toLowerCase().slice(entry.name.lastIndexOf("."));
			if (![
				".md",
				".markdown",
				".json",
				".jsonl",
				".ndjson"
			].includes(extension)) continue;
			scannedFiles += 1;
			if ((entry.size ?? 0) > maxTextChars) {
				warnings.push(`${child}: 超过 maxTextChars，已跳过。`);
				continue;
			}
			try {
				const values = candidatesFromText(child, await fs.readText(entry.target, signal));
				for (const value of values) {
					const envelope = value && typeof value === "object" && !Array.isArray(value) ? value : {};
					const data = Object.hasOwn(envelope, "data") ? envelope.data : value;
					const review = reviewArtifact(data);
					if (Object.hasOwn(envelope, "data") && envelope.ok !== true) {
						review.status = "blocked";
						review.issues.push("来源工具结果失败。");
					}
					const record$1 = data && typeof data === "object" && !Array.isArray(data) ? data : {};
					artifacts.push({
						...includeValues ? { value: envelope } : {},
						path: child,
						artifactId: typeof record$1.artifactId === "string" ? record$1.artifactId : void 0,
						artifactType: typeof record$1.artifactType === "string" ? record$1.artifactType : void 0,
						generatedAt: typeof record$1.generatedAt === "string" ? record$1.generatedAt : void 0,
						staleAfter: typeof record$1.staleAfter === "string" ? record$1.staleAfter : void 0,
						status: review.status,
						issues: review.issues,
						warnings: review.warnings
					});
				}
			} catch (error) {
				warnings.push(`${child}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	await walk(root, await fs.resolve(root, { signal }));
	return {
		root,
		scannedFiles,
		artifacts,
		warnings
	};
}
async function appendArtifactAudit(fs, root, event, signal) {
	const path = join(root, ".dsh-business-audit.jsonl");
	const target = await fs.resolve(path, { signal });
	const info = await fs.stat(target, signal);
	const next = `${info?.type === "file" ? await fs.readText(target, signal) : ""}${JSON.stringify({
		...event,
		plugin: artifactDomain,
		recordedAt: (/* @__PURE__ */ new Date()).toISOString()
	})}\n`;
	await fs.writeText(target, next, info ? {
		kind: "replaceIfVersion",
		version: info.version
	} : { kind: "createIfAbsent" }, signal);
	return {
		path,
		entries: next.trim() ? next.trim().split(/\r?\n/).length : 0
	};
}

//#endregion
//#region src/handoff-routes.ts
const handoffRoutes = {
	"opportunity-handoff": {
		"from": "dsh-idea",
		"nextTool": "business_model_review",
		"purpose": "引用机会证据，审查价值、收入假设和成本；不接管产品交付。",
		"text": [
			"source",
			"targetUser",
			"problem"
		],
		"lists": ["evidence"],
		"mode": "reference"
	},
	"product-sales-handoff": {
		"from": "dsh-product",
		"nextTool": "business_pricing_review",
		"purpose": "引用产品价值和交付边界，审查价格、成本与审批约束。",
		"text": ["source", "productName"],
		"lists": ["valueEvidence", "proofPoints"],
		"mode": "reference"
	}
};

//#endregion
//#region src/handoff-receive.ts
const handoffParameters = {
	artifactJson: {
		type: "string",
		required: true,
		description: "Original JSON artifact or successful result envelope; preserve its checksum."
	},
	initiativeId: {
		type: "string",
		required: true,
		description: "Stable ID shared by all receipts for this business initiative."
	},
	owner: {
		type: "string",
		required: true,
		description: "Human responsible for the next action."
	},
	action: {
		type: "string",
		required: true,
		description: "Concrete next action, not a claim of completion."
	},
	dueDate: {
		type: "string",
		required: true,
		description: "ISO date or timestamp for the action deadline."
	}
};
function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function text(value) {
	return typeof value === "string" ? value.trim() : "";
}
function meaningful(value) {
	return typeof value === "string" ? !!value.trim() : Object.keys(asRecord(value)).length > 0;
}
function receiveHandoff(value, options) {
	const envelope = asRecord(value);
	const isEnvelope = Object.hasOwn(envelope, "data");
	const source = asRecord(isEnvelope ? envelope.data : value);
	const review = reviewArtifact(source);
	const issues = [...review.issues];
	const warnings = [...review.warnings];
	const missing = [];
	const sourceType = text(source.artifactType);
	const route = Object.hasOwn(handoffRoutes, sourceType) ? handoffRoutes[sourceType] : void 0;
	if (isEnvelope && envelope.ok !== true) issues.push("来源工具未成功，不能消费其 data。");
	if (!route) issues.push(`本插件不接收 ${sourceType || "unknown"}，请按职责交接。`);
	if (route) {
		if (source.handoffFrom !== route.from) issues.push(`handoffFrom 必须为 ${route.from}。`);
		if (route.mode === "direct" && source.handoffTo !== artifactDomain) issues.push(`handoffTo 必须为 ${artifactDomain}，不能消费发给其他插件的交接。`);
		for (const field of route.text) if (!text(source[field])) missing.push(field);
		for (const field of route.lists) {
			const values = source[field];
			if (!Array.isArray(values) || values.length === 0 || !values.every(meaningful)) missing.push(field);
		}
	}
	for (const field of [
		"initiativeId",
		"owner",
		"action"
	]) if (!options[field].trim()) missing.push(field);
	if (!validDate(options.dueDate)) issues.push("dueDate 必须是有效 ISO 日期或时间。");
	else if (Date.parse(options.dueDate.length === 10 ? options.dueDate + "T23:59:59Z" : options.dueDate) < Date.now()) missing.push("dueDate 已逾期，请明确新的行动日期");
	if (source.initiativeId && source.initiativeId !== options.initiativeId.trim()) issues.push("initiativeId 与来源不一致。");
	if ([
		"blocked",
		"stale",
		"rejected"
	].includes(text(source.status)) || ["hold", "stop"].includes(text(source.decision))) issues.push("上游工件要求停止或重新审查，不能向下推进。");
	if ([
		"partial",
		"draft",
		"open",
		"implemented",
		"accepted"
	].includes(text(source.status))) missing.push("上游尚未完成验证");
	if (review.status === "stale") issues.push("来源已过期，必须回到生产插件重新核验。");
	if (sourceType === "opportunity-handoff" && Object.keys(asRecord(source.validationExperiment)).length === 0) missing.push("validationExperiment");
	if (sourceType === "product-sales-handoff" && !["proceed", "scale"].includes(text(source.productDecision))) missing.push("productDecision");
	if (sourceType === "product-feedback-closure" && source.status !== "verified") missing.push("反馈尚未 verified");
	if (sourceType === "sales-feedback-handoff") {
		if (!["dsh-growth"].includes(artifactDomain) && (!Array.isArray(source.feedback) || !source.feedback.length || !source.feedback.every((value$1) => {
			const row = asRecord(value$1);
			return typeof row.reason === "string" && !!row.reason.trim() && typeof row.count === "number" && Number.isInteger(row.count) && row.count > 0;
		}))) missing.push("feedback.reason/count");
		const summary = asRecord(source.summary);
		if (![summary.won, summary.lost].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)) missing.push("summary.won/lost");
		else if (Number(summary.won) + Number(summary.lost) === 0) missing.push("没有可复盘的成交或失单记录");
	}
	const sourceWarnings = [source.warnings, envelope.warnings].flatMap((items) => Array.isArray(items) ? items.filter((item) => typeof item === "string" && !!item.trim()) : []);
	const status = issues.length > 0 ? "blocked" : missing.length > 0 || review.status !== "ready" ? "needs-validation" : "accepted";
	const contextKeys = [...new Set([
		...route?.text ?? [],
		...route?.lists ?? [],
		"validationExperiment",
		"riskiestAssumption",
		"summary",
		"feedback",
		"openQuestions",
		"commercialQuestions",
		"requiredApprovals",
		"risks",
		"claimBoundaries",
		"sourceArtifactId"
	])];
	const context = Object.fromEntries(contextKeys.filter((key) => source[key] !== void 0).map((key) => [key, source[key]]));
	const nextActions = status === "accepted" ? [
		`${options.owner.trim()}：在 ${options.dueDate} 前${options.action.trim()}。`,
		`下一工具：${route?.nextTool}。`,
		route?.purpose ?? ""
	] : [
		...issues,
		...missing.map((field) => `补齐或核验：${field}。`),
		"修正来源并重新接收；不要修改回执状态冒充完成。"
	];
	return {
		artifactType: "handoff-receipt",
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		initiativeId: options.initiativeId.trim(),
		receivedBy: artifactDomain,
		mode: route?.mode ?? "direct",
		status,
		sourceArtifactId: text(source.artifactId),
		sourceArtifactType: sourceType,
		sourceContentHash: text(source.contentHash),
		sourceProducer: text(source.handoffFrom),
		sourceStatus: text(source.status),
		owner: options.owner.trim(),
		action: options.action.trim(),
		dueDate: options.dueDate,
		nextTool: route?.nextTool ?? "",
		purpose: route?.purpose ?? "",
		context,
		issues,
		missing,
		warnings: [...new Set([...warnings, ...sourceWarnings])],
		approvalGranted: false,
		completionClaimed: false,
		nextActions
	};
}

//#endregion
//#region src/loop-review.ts
function record(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function reviewLoopArtifacts(values, initiativeId) {
	const issues = [];
	const warnings = [];
	const unique$1 = /* @__PURE__ */ new Map();
	let duplicates = 0;
	for (const value of values) {
		const envelope = record(value);
		if (Object.hasOwn(envelope, "data") && envelope.ok !== true) {
			issues.push("存在失败的工具结果，不能用于闭环。");
			continue;
		}
		const item = record(Object.hasOwn(envelope, "data") ? envelope.data : value);
		const id = typeof item.artifactId === "string" ? item.artifactId : "";
		if (!id) {
			issues.push("存在没有 artifactId 的工件。");
			continue;
		}
		const previous = unique$1.get(id);
		if (previous) {
			duplicates += 1;
			if (previous.contentHash !== item.contentHash) issues.push(`同一 artifactId 存在冲突版本：${id}。请明确最新版本并刷新回执。`);
		} else unique$1.set(id, item);
	}
	if (!initiativeId.trim()) issues.push("必须提供 initiativeId，以免把不同事项的工件拼成闭环。");
	const artifacts = [...unique$1.values()];
	const reviews = new Map(artifacts.map((item) => {
		const review = reviewArtifact(item);
		if (review.status === "blocked") issues.push(...review.issues.map((issue) => `${String(item.artifactId)}：${issue}`));
		warnings.push(...review.warnings);
		return [item.artifactId, review];
	}));
	const usable = artifacts.filter((item) => item.artifactType === "handoff-receipt" && item.initiativeId === initiativeId.trim() && item.status === "accepted").filter((receipt) => {
		const source = unique$1.get(String(receipt.sourceArtifactId));
		if (!source || source.contentHash !== receipt.sourceContentHash) {
			warnings.push(`回执 ${String(receipt.artifactId)} 缺少对应原工件或绑定的版本已变化。`);
			return false;
		}
		if (source.initiativeId && source.initiativeId !== initiativeId.trim()) {
			issues.push("回执与来源不属于同一事项。");
			return false;
		}
		return reviews.get(receipt.artifactId)?.status === "ready" && reviews.get(source.artifactId)?.status === "ready" && validDate(receipt.dueDate) && receipt.sourceArtifactType === source.artifactType && typeof receipt.owner === "string" && !!receipt.owner.trim() && typeof receipt.action === "string" && !!receipt.action.trim() && receipt.approvalGranted === false && receipt.completionClaimed === false;
	});
	const has = (receiver, type) => usable.some((item) => item.receivedBy === receiver && item.sourceArtifactType === type);
	const productOpportunity = usable.find((item) => item.receivedBy === "dsh-product" && item.sourceArtifactType === "opportunity-handoff");
	const commercialContext = usable.some((item) => item.receivedBy === "dsh-business" && item.sourceArtifactType === "opportunity-handoff" && item.sourceArtifactId === productOpportunity?.sourceArtifactId);
	const closure = usable.find((item) => {
		if (item.receivedBy !== "dsh-sales" || item.sourceArtifactType !== "product-feedback-closure") return false;
		const closed = unique$1.get(String(item.sourceArtifactId));
		const feedback = closed && unique$1.get(String(closed.sourceArtifactId));
		const verification = record(closed?.verification);
		return closed?.status === "verified" && verification.result === "passed" && typeof verification.method === "string" && !!verification.method.trim() && typeof verification.source === "string" && !!verification.source.trim() && validDate(verification.observedAt) && validDate(feedback?.generatedAt) && Date.parse(verification.observedAt) >= Date.parse(feedback.generatedAt) && Date.parse(verification.observedAt) <= Date.now() && closed.initiativeId === initiativeId.trim() && typeof closed.evidence === "string" && !!closed.evidence.trim() && feedback?.artifactType === "sales-feedback-handoff" && feedback.contentHash === closed.sourceContentHash && usable.some((receipt) => receipt.receivedBy === "dsh-product" && receipt.sourceArtifactId === closed.sourceArtifactId);
	});
	const productMetrics = new Set(usable.filter((item) => item.receivedBy === "dsh-growth" && item.sourceArtifactType === "growth-handoff").map((item) => unique$1.get(String(item.sourceArtifactId))?.primaryMetric));
	const publicMetrics = new Set(usable.filter((item) => item.receivedBy === "dsh-geo" && item.sourceArtifactType === "product-discoverability-handoff").map((item) => unique$1.get(String(item.sourceArtifactId))?.targetMetric));
	const measured = artifacts.some((item) => item.artifactType === "growth-attribution-review" && item.status === "measured" && reviews.get(item.artifactId)?.status === "ready" && Array.isArray(item.results) && item.results.length > 0 && item.results.every((value) => {
		const result = record(value);
		const plan = unique$1.get(String(result.planArtifactId));
		return result.status === "measured" && plan?.contentHash === result.planContentHash && productMetrics.has(plan?.targetMetric) && publicMetrics.has(plan?.targetMetric) && usable.some((receipt) => receipt.receivedBy === "dsh-growth" && receipt.sourceArtifactId === result.planArtifactId);
	}));
	const gates = [
		{
			id: "discovery",
			label: "产品已接收机会原件",
			satisfied: !!productOpportunity
		},
		{
			id: "commercial",
			label: "同一机会经过商业审查，商业约束已被销售接收",
			satisfied: commercialContext && has("dsh-sales", "commercial-handoff")
		},
		{
			id: "product",
			label: "销售已接收产品价值与交付边界",
			satisfied: has("dsh-sales", "product-sales-handoff")
		},
		{
			id: "discoverability",
			label: "GEO 已接收允许公开的事实与禁止承诺",
			satisfied: has("dsh-geo", "product-discoverability-handoff")
		},
		{
			id: "measurement",
			label: "增长已接收产品指标和 GEO 计划，并提供绑定版本的实际观测",
			satisfied: has("dsh-growth", "growth-handoff") && has("dsh-growth", "geo-growth-measurement-plan") && measured
		},
		{
			id: "feedback",
			label: "产品已接收销售反馈并明确处理动作",
			satisfied: has("dsh-product", "sales-feedback-handoff")
		},
		{
			id: "closure",
			label: "反馈完成复验，且原反馈方接收了对应版本的处理结果",
			satisfied: !!closure
		}
	];
	const missing = gates.filter((gate) => !gate.satisfied);
	const status = issues.length ? "blocked" : missing.length ? "partial" : "ready";
	return {
		artifactType: "business-loop-review",
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		initiativeId: initiativeId.trim(),
		status,
		coordinationClosed: status === "ready",
		businessImpact: measured ? "observed-not-attributed" : "not-measured",
		gates,
		missing,
		artifactCount: artifacts.length,
		duplicates,
		acceptedReceiptCount: usable.length,
		issues,
		warnings: [...new Set(warnings)],
		newDiscoveryReceived: has("dsh-idea", "sales-feedback-handoff"),
		nextActions: [
			...issues,
			...missing.map((gate) => `补齐：${gate.label}。请提交原工件和同一 initiativeId 的接收回执。`),
			...status === "ready" ? ["协作反馈链已闭合；接收和复验不等于成交、留存或利润改善，请用实际业务数据复盘。"] : [],
			"发现新的市场问题时，将面向 dsh-idea 的销售反馈交给 idea_handoff_receive；不必为了凑齐流程编造新发现。"
		]
	};
}

//#endregion
//#region src/business.ts
function unique(items) {
	return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
function clean(value) {
	return value?.trim() ?? "";
}
function finite(value, fallback = 0) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function nonNegative(value, fallback = 0) {
	return Math.max(0, finite(value, fallback));
}
function pct(value) {
	return Number((value * 100).toFixed(2));
}
function money$1(value) {
	return Number(value.toFixed(2)).toString();
}
function markdownList$1(items) {
	return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- 暂无";
}
function artifactHeader(type, title, status, extra = {}) {
	const lines = [
		"---",
		`type: ${type}`,
		`title: ${title}`,
		`status: ${status}`
	];
	for (const [key, value] of Object.entries(extra)) if (value) lines.push(`${key}: ${value.replace(/\r?\n/g, " ")}`);
	lines.push("---", "");
	return lines.join("\n");
}
function buildBusinessModelReview(input) {
	const missing = [];
	if (!clean(input.targetCustomer)) missing.push("目标客户");
	if (!clean(input.valueProposition)) missing.push("价值主张");
	if (input.revenueStreams.length === 0) missing.push("收入来源");
	if (!clean(input.pricingModel)) missing.push("定价/收费模式");
	if (input.channels.length === 0) missing.push("渠道");
	if (input.costDrivers.length === 0) missing.push("成本驱动因素");
	const missingEvidence = input.evidence.filter((item) => item.status === "missing").map((item) => item.label);
	const assumptions = input.evidence.filter((item) => item.status === "assumption").map((item) => item.label);
	const warnings = [];
	if (input.evidence.length === 0) warnings.push("没有提供事实、假设或来源；商业模式仍缺少可追溯证据。");
	if (missingEvidence.length > 0) warnings.push(`以下证据仍缺失：${missingEvidence.join("、")}。`);
	if (assumptions.length > 0) warnings.push(`以下判断仍是假设：${assumptions.join("、")}。`);
	let decision;
	if (input.fitStatus === "disproved") decision = "reject";
	else if (missing.some((item) => [
		"目标客户",
		"价值主张",
		"收入来源"
	].includes(item))) decision = "hold";
	else if (missing.length > 0 || missingEvidence.length > 0) decision = "hold";
	else if (assumptions.length > 0 || input.fitStatus === "uncertain") decision = "revise";
	else decision = "proceed";
	const status = decision === "reject" ? "blocked" : decision === "proceed" ? "ready" : "partial";
	const nextActions = decision === "reject" ? ["记录被证伪的客户、价值或收入假设。", "关闭当前商业模式，或回到 dsh-idea 重新定义机会。"] : decision === "hold" ? [`补齐：${unique([...missing, ...missingEvidence]).join("、") || "关键商业证据"}。`, "在作出投入或放弃决定前，明确验证方法、阈值和日期。"] : decision === "revise" ? ["将关键假设转成最小验证或付费测试。", "补充实际价格、渠道成本和客户行为证据，再复核商业模式。"] : ["进入定价、渠道经济和盈利能力复核。", "设定商业模式复盘周期，避免把一次性成交当成可重复模型。"];
	const review = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "business-model-review",
		businessName: input.businessName,
		targetCustomer: input.targetCustomer,
		valueProposition: input.valueProposition,
		revenueStreams: input.revenueStreams,
		pricingModel: input.pricingModel,
		channels: input.channels,
		costDrivers: input.costDrivers,
		evidence: input.evidence,
		status,
		decision,
		missing: unique([...missing, ...missingEvidence]),
		warnings,
		assumptions,
		nextActions,
		markdown: ""
	};
	review.markdown = [
		artifactHeader("business-model-review", `${input.businessName} 商业模式`, status),
		`# ${input.businessName} 商业模式复盘`,
		"",
		`- 状态：${status}`,
		`- 决策：${decision}`,
		`- 目标客户：${input.targetCustomer || "待补充"}`,
		`- 价值主张：${input.valueProposition || "待补充"}`,
		"",
		"## 收入来源",
		markdownList$1(input.revenueStreams),
		"",
		"## 定价模式",
		input.pricingModel || "待补充",
		"",
		"## 渠道",
		markdownList$1(input.channels),
		"",
		"## 成本驱动",
		markdownList$1(input.costDrivers),
		"",
		"## 缺口与假设",
		markdownList$1(unique([...review.missing, ...review.assumptions])),
		"",
		"## 下一步",
		markdownList$1(nextActions),
		""
	].join("\n");
	return review;
}
function offerResult(input) {
	const listPrice = nonNegative(input.listPrice);
	const discountRate = nonNegative(input.discountRate);
	const effectivePrice = input.transactionPrice !== void 0 ? finite(input.transactionPrice) : input.supplyPrice !== void 0 ? finite(input.supplyPrice) : listPrice * (1 - discountRate / 100);
	const unitCost = nonNegative(input.unitCost);
	const commissionRate = nonNegative(input.commissionRate);
	const logisticsPerUnit = nonNegative(input.logisticsPerUnit);
	const otherVariableCostPerUnit = nonNegative(input.otherVariableCostPerUnit);
	const channelCostPerUnit = effectivePrice * commissionRate / 100 + logisticsPerUnit + otherVariableCostPerUnit;
	const grossProfitPerUnit = effectivePrice - unitCost;
	const contributionPerUnit = grossProfitPerUnit - channelCostPerUnit;
	const grossMarginPct = effectivePrice > 0 ? pct(grossProfitPerUnit / effectivePrice) : 0;
	const contributionMarginPct = effectivePrice > 0 ? pct(contributionPerUnit / effectivePrice) : 0;
	const reasons = [];
	if (listPrice <= 0 || effectivePrice <= 0) reasons.push("价格必须大于 0。");
	if (input.minimumTransactionPrice !== void 0 && effectivePrice < input.minimumTransactionPrice) reasons.push(`成交价低于最低交易价 ${money$1(input.minimumTransactionPrice)}。`);
	if (effectivePrice > listPrice && listPrice > 0) reasons.push("成交价高于标价，请确认价格口径。");
	if (contributionPerUnit < 0) reasons.push("扣除产品成本和渠道成本后为负贡献。");
	if (input.targetContributionMargin !== void 0 && contributionMarginPct < input.targetContributionMargin) reasons.push(`贡献毛利率 ${contributionMarginPct}% 低于目标 ${input.targetContributionMargin}%。`);
	if (input.targetContributionMargin === void 0 && contributionMarginPct >= 0 && contributionMarginPct < 10) reasons.push("贡献毛利率低于 10%，建议补充目标利润率和护栏。");
	const blocked = reasons.some((reason) => reason.includes("低于最低交易价") || reason.includes("负贡献") || reason.includes("必须大于"));
	const warning = reasons.length > 0;
	const status = blocked ? "blocked" : warning ? "warning" : "healthy";
	return {
		...input,
		effectivePrice,
		grossProfitPerUnit,
		grossMarginPct,
		channelCostPerUnit,
		contributionPerUnit,
		contributionMarginPct,
		estimatedContribution: input.volume === void 0 ? void 0 : contributionPerUnit * nonNegative(input.volume),
		status,
		reasons
	};
}
function buildBusinessPricingReview(input) {
	const offers = input.offers.map(offerResult);
	const priceGapWarningPct = input.priceGapWarningPct ?? 15;
	const priceConflicts = [];
	const skus = unique(offers.map((offer) => offer.sku));
	for (const sku of skus) {
		const sameSku = offers.filter((offer) => offer.sku === sku);
		if (sameSku.length < 2) continue;
		const prices = sameSku.map((offer) => offer.effectivePrice);
		const min = Math.min(...prices);
		const max = Math.max(...prices);
		const spreadPct = min > 0 ? pct((max - min) / min) : 0;
		if (spreadPct > priceGapWarningPct) priceConflicts.push(`${sku} 在渠道间有效成交价差异 ${spreadPct}%，超过 ${priceGapWarningPct}%：${sameSku.map((offer) => `${offer.channel}=${money$1(offer.effectivePrice)}`).join("，")}。`);
	}
	const blocked = offers.some((offer) => offer.status === "blocked");
	const warning = offers.some((offer) => offer.status === "warning") || priceConflicts.length > 0;
	const status = blocked ? "blocked" : warning ? "partial" : offers.length > 0 ? "ready" : "blocked";
	const decision = status === "blocked" ? "hold" : status === "partial" ? "revise" : "proceed";
	const warnings = [...priceConflicts, ...offers.flatMap((offer) => offer.reasons.map((reason) => `${offer.sku}/${offer.channel}：${reason}`))];
	const nextActions = status === "blocked" ? ["暂停扩大低于最低交易价或产生负贡献的渠道。", "重新核对产品成本、渠道费率、促销折扣和最低交易边界。"] : status === "partial" ? ["建立统一的标价、供货价、成交价和最低交易价口径。", "为渠道冲突和目标贡献毛利率设置审批与复盘规则。"] : ["记录各渠道价格和贡献毛利率基线。", "设置价格、促销和渠道利润的定期复盘周期。"];
	const review = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "business-pricing-review",
		productName: input.productName,
		currency: input.currency,
		offers,
		priceConflicts,
		status,
		decision,
		warnings,
		assumptions: [
			"commissionRate、discountRate 和 targetContributionMargin 使用百分比输入，例如 15 表示 15%。",
			"未提供 transactionPrice 时，优先使用 supplyPrice，否则按 listPrice × (1 - discountRate) 估算。",
			"渠道价差是风险提示，不是统一价格的自动结论；不同渠道需要结合服务、流量和履约成本判断。"
		],
		nextActions,
		markdown: ""
	};
	review.markdown = [
		artifactHeader("business-pricing-review", `${input.productName} 定价复盘`, status, { currency: input.currency }),
		`# ${input.productName} 定价与渠道经济复盘`,
		"",
		`- 状态：${status}`,
		`- 决策：${decision}`,
		`- 币种：${input.currency}`,
		"",
		"## 渠道价格与利润",
		"| SKU | 渠道 | 有效成交价 | 单位贡献 | 贡献毛利率 | 状态 |",
		"| --- | --- | ---: | ---: | ---: | --- |",
		offers.length > 0 ? offers.map((offer) => `| ${offer.sku} | ${offer.channel} | ${money$1(offer.effectivePrice)} | ${money$1(offer.contributionPerUnit)} | ${offer.contributionMarginPct}% | ${offer.status} |`).join("\n") : "| 暂无 | — | — | — | — | blocked |",
		"",
		"## 价盘冲突",
		markdownList$1(priceConflicts),
		"",
		"## 假设与限制",
		markdownList$1(review.assumptions),
		"",
		"## 下一步",
		markdownList$1(nextActions),
		""
	].join("\n");
	return review;
}
function profitabilityLine(input) {
	const units = nonNegative(input.units);
	const revenuePerUnit = nonNegative(input.revenuePerUnit);
	const variableCostPerUnit = nonNegative(input.variableCostPerUnit);
	const revenue = units * revenuePerUnit + nonNegative(input.otherRevenue);
	const variableCost = units * variableCostPerUnit;
	const fixedCost = nonNegative(input.fixedCost);
	const otherCost = nonNegative(input.otherCost);
	const contribution = revenue - variableCost;
	const totalCost = variableCost + fixedCost + otherCost;
	const profit = revenue - totalCost;
	const contributionMarginPct = revenue > 0 ? pct(contribution / revenue) : 0;
	const profitMarginPct = revenue > 0 ? pct(profit / revenue) : 0;
	return {
		...input,
		units,
		revenuePerUnit,
		variableCostPerUnit,
		fixedCost,
		otherRevenue: nonNegative(input.otherRevenue),
		otherCost,
		revenue,
		variableCost,
		contribution,
		totalCost,
		profit,
		contributionMarginPct,
		profitMarginPct,
		status: profit > 0 ? "profitable" : profit < 0 ? "loss-making" : "break-even"
	};
}
function buildBusinessProfitabilityReview(input) {
	const lines = input.lines.map(profitabilityLine);
	const totals = lines.reduce((result, line) => ({
		revenue: result.revenue + line.revenue,
		variableCost: result.variableCost + line.variableCost,
		contribution: result.contribution + line.contribution,
		fixedCost: result.fixedCost + (line.fixedCost ?? 0),
		totalCost: result.totalCost + line.totalCost,
		profit: result.profit + line.profit,
		contributionMarginPct: 0,
		profitMarginPct: 0
	}), {
		revenue: 0,
		variableCost: 0,
		contribution: 0,
		fixedCost: 0,
		totalCost: 0,
		profit: 0,
		contributionMarginPct: 0,
		profitMarginPct: 0
	});
	totals.contributionMarginPct = totals.revenue > 0 ? pct(totals.contribution / totals.revenue) : 0;
	totals.profitMarginPct = totals.revenue > 0 ? pct(totals.profit / totals.revenue) : 0;
	const warnings = [];
	if (lines.length === 0) warnings.push("没有提供产品、渠道或收入线，无法判断盈利能力。");
	if (lines.some((line) => line.revenue === 0)) warnings.push("存在收入为 0 的项目；请确认销量、单价或收入字段。");
	const status = lines.length === 0 ? "insufficient-evidence" : totals.profit > 0 ? "profitable" : totals.profit < 0 ? "loss-making" : "break-even";
	const nextActions = status === "insufficient-evidence" ? ["补充销量、单价、变动成本和固定成本，再运行盈利复盘。"] : status === "loss-making" ? ["优先拆解亏损项目的价格、单位成本、渠道成本和固定成本。", "做价格、销量、成本和渠道组合的敏感性分析，不只看收入增长。"] : status === "break-even" ? ["补充目标利润率和安全缓冲，避免把盈亏平衡当成可规模化模型。", "验证促销、退货、坏账和现金周转是否会侵蚀利润。"] : ["验证利润是否来自可重复的销量、价格和成本结构。", "设置毛利、贡献利润和现金回收的定期复盘。"];
	const review = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "business-profitability-review",
		businessName: input.businessName,
		currency: input.currency,
		lines,
		totals,
		status,
		warnings,
		assumptions: ["fixedCost 和 otherCost 按当前复盘周期归属于对应项目。", "未提供税费、退货、坏账或现金周转数据时，profit 是管理口径估算，不等同于会计净利润。"],
		nextActions,
		markdown: ""
	};
	review.markdown = [
		artifactHeader("business-profitability-review", `${input.businessName} 盈利复盘`, status, { currency: input.currency }),
		`# ${input.businessName} 盈利能力复盘`,
		"",
		`- 状态：${status}`,
		`- 收入：${money$1(totals.revenue)} ${input.currency}`,
		`- 贡献利润：${money$1(totals.contribution)} ${input.currency}`,
		`- 利润：${money$1(totals.profit)} ${input.currency}`,
		`- 利润率：${totals.profitMarginPct}%`,
		"",
		"## 项目明细",
		"| 项目 | 收入 | 总成本 | 利润 | 利润率 | 状态 |",
		"| --- | ---: | ---: | ---: | ---: | --- |",
		lines.length > 0 ? lines.map((line) => `| ${line.name} | ${money$1(line.revenue)} | ${money$1(line.totalCost)} | ${money$1(line.profit)} | ${line.profitMarginPct}% | ${line.status} |`).join("\n") : "| 暂无 | — | — | — | — | insufficient-evidence |",
		"",
		"## 假设与限制",
		markdownList$1(review.assumptions),
		"",
		"## 下一步",
		markdownList$1(nextActions),
		""
	].join("\n");
	return review;
}
function buildElevatorPitch(input) {
	const differentiation = clean(input.differentiation);
	const proof = clean(input.proof);
	const ask = clean(input.ask);
	const warnings = [];
	if (!differentiation) warnings.push("缺少差异化，Pitch 容易退化成通用产品描述。");
	if (!proof) warnings.push("缺少证据或结果，当前表达仍是价值假设。");
	if (!ask) warnings.push("缺少下一步请求；面向投资人、客户或合作方时应明确希望对方做什么。");
	const short = `${input.businessName} 帮助${input.targetCustomer}解决“${input.problem}”，通过${input.solution}${differentiation ? `，并以${differentiation}区别于替代方案` : ""}。`;
	const medium = `${short}${proof ? ` 目前的证据是：${proof}。` : ""}${ask ? ` 我们现在希望：${ask}。` : ""}`;
	const long = [
		`我们服务的对象是${input.targetCustomer}。`,
		`他们在${input.problem}上遇到持续成本或风险。`,
		`我们提供${input.solution}，核心价值是让这件事变得更可预测、更高效或更有收益。`,
		differentiation ? `与现有替代方案相比，关键差异是${differentiation}。` : "目前还需要补充与替代方案的明确差异。",
		proof ? `已有证据包括：${proof}。` : "目前还需要补充客户、收入、使用或交付证据。",
		ask ? `下一步希望得到：${ask}。` : "下一步应明确希望听众提供的资源、试用、介绍或决策。"
	].join(" ");
	const result = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "elevator-pitch",
		businessName: input.businessName,
		targetCustomer: input.targetCustomer,
		problem: input.problem,
		solution: input.solution,
		differentiation,
		proof,
		ask,
		pitches: {
			thirtySecond: short,
			sixtySecond: medium,
			twoMinute: long
		},
		warnings,
		nextActions: warnings.length > 0 ? ["补充差异化、证据和明确请求，再按听众分别练习。"] : ["按客户、投资人和合作方分别调整证据与请求。", "用真实场景和结果替换抽象形容词。"],
		markdown: ""
	};
	result.markdown = [
		artifactHeader("elevator-pitch", `${input.businessName} Elevator Pitch`, warnings.length > 0 ? "partial" : "ready"),
		`# ${input.businessName} 电梯 Pitch`,
		"",
		"## 30 秒",
		short,
		"",
		"## 60 秒",
		medium,
		"",
		"## 2 分钟",
		long,
		"",
		"## 需要补强",
		markdownList$1(warnings),
		""
	].join("\n");
	return result;
}
function buildBusinessPlan(input) {
	const missing = [];
	if (!clean(input.customer)) missing.push("目标客户");
	if (!clean(input.problem)) missing.push("问题");
	if (!clean(input.valueProposition)) missing.push("价值主张");
	if (!clean(input.businessModel)) missing.push("商业模式");
	if (!clean(input.market)) missing.push("市场");
	if (!clean(input.pricing)) missing.push("定价");
	if (input.channels.length === 0) missing.push("渠道");
	if (input.goToMarket.length === 0) missing.push("获客/进入市场计划");
	if (input.metrics.length === 0) missing.push("指标");
	const status = missing.some((item) => [
		"目标客户",
		"问题",
		"价值主张",
		"商业模式"
	].includes(item)) ? "blocked" : missing.length > 0 ? "partial" : "ready";
	const warnings = missing.length > 0 ? [`商业计划缺少：${missing.join("、")}。`] : [];
	const executiveSummary = clean(input.executiveSummary) || `${input.businessName} 面向${input.customer}，解决${input.problem}，通过${input.valueProposition}创造价值，采用${input.businessModel}，并通过${input.channels.join("、")}触达客户。`;
	const nextActions = status === "blocked" ? ["先补齐客户、问题、价值主张和商业模式，避免把计划写成愿望清单。"] : status === "partial" ? ["补齐缺失的市场、定价、渠道或指标证据。", "把关键假设、负责人、验证日期和退出条件写入计划。"] : ["将商业计划中的假设连接到定价、盈利和产品决策门。", "按月或按关键里程碑复盘实际结果与计划差异。"];
	const plan = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		artifactType: "business-plan",
		businessName: input.businessName,
		executiveSummary,
		customer: input.customer,
		problem: input.problem,
		valueProposition: input.valueProposition,
		market: input.market,
		businessModel: input.businessModel,
		pricing: input.pricing,
		channels: input.channels,
		goToMarket: input.goToMarket,
		operations: input.operations,
		metrics: input.metrics,
		milestones: input.milestones,
		risks: input.risks,
		status,
		warnings,
		assumptions: ["商业计划是决策和验证文档，不是对未来结果的保证。", "市场规模、价格、转化率、成本和时间表应标明来源或假设。"],
		nextActions,
		markdown: ""
	};
	plan.markdown = [
		artifactHeader("business-plan", `${input.businessName} Business Plan`, status),
		`# ${input.businessName} 商业计划`,
		"",
		"## 执行摘要",
		executiveSummary,
		"",
		"## 客户与问题",
		`- 目标客户：${input.customer || "待补充"}`,
		`- 问题：${input.problem || "待补充"}`,
		`- 价值主张：${input.valueProposition || "待补充"}`,
		"",
		"## 市场",
		input.market || "待补充",
		"",
		"## 商业模式与定价",
		`- 商业模式：${input.businessModel || "待补充"}`,
		`- 定价：${input.pricing || "待补充"}`,
		"",
		"## 渠道与进入市场",
		"**渠道**",
		markdownList$1(input.channels),
		"",
		"**进入市场动作**",
		markdownList$1(input.goToMarket),
		"",
		"## 运营",
		markdownList$1(input.operations),
		"",
		"## 指标与里程碑",
		"**指标**",
		markdownList$1(input.metrics),
		"",
		"**里程碑**",
		markdownList$1(input.milestones),
		"",
		"## 风险",
		markdownList$1(input.risks),
		"",
		"## 假设与限制",
		markdownList$1(plan.assumptions),
		"",
		"## 下一步",
		markdownList$1(nextActions),
		""
	].join("\n");
	return plan;
}

//#endregion
//#region src/commercial.ts
function money(value) {
	return Number.isFinite(value) ? value.toFixed(2) : "缺失";
}
function markdownList(values) {
	return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- 无";
}
function buildCommercialHandoff(input) {
	const offers = input.pricing.offers.map((offer) => ({
		sku: offer.sku,
		channel: offer.channel,
		effectivePrice: offer.effectivePrice,
		...offer.minimumTransactionPrice !== void 0 ? { minimumTransactionPrice: offer.minimumTransactionPrice } : {},
		unitCost: offer.unitCost,
		contributionPerUnit: offer.contributionPerUnit,
		contributionMarginPct: offer.contributionMarginPct,
		status: offer.status
	}));
	const warnings = [...input.pricing.warnings];
	const risks = [...input.pricing.priceConflicts];
	if (offers.length === 0) warnings.push("没有报价行；不能形成可审查的商业交接。");
	for (const offer of offers) {
		if (offer.minimumTransactionPrice === void 0) warnings.push(`${offer.sku}/${offer.channel} 缺少明确的最低成交价；不得把有效成交价当作授权底线。`);
		if (offer.contributionPerUnit < 0) risks.push(`${offer.sku}/${offer.channel} 单位贡献为负：${money(offer.contributionPerUnit)}。`);
		if (offer.status === "blocked") risks.push(`${offer.sku}/${offer.channel} 当前报价状态为 blocked。`);
	}
	if (!input.profitability) warnings.push("未提供盈利复盘；商业交接不能代表整体盈利能力。");
	if (input.profitability?.status === "loss-making") risks.push("盈利复盘显示整体为 loss-making，销售推进前需要明确止损或调整方案。");
	const requiredApprovals = ["由有权限的负责人确认最低成交价、成本基础、付款条款和折扣授权。", input.handoffTo === "dsh-sales" ? "dsh-sales 只能在上述边界确认后进入报价与谈判。" : "dsh-product 将商业约束作为范围和包装输入，不把它当作市场需求证据。"];
	const status = input.pricing.status === "blocked" || risks.length > 0 ? "blocked" : warnings.length > 0 ? "partial" : "ready-for-review";
	const decision = status === "blocked" ? "hold" : "review";
	const nextActions = status === "ready-for-review" ? ["由业务负责人或财务/销售授权人完成审批，不由本插件代替授权。", input.handoffTo === "dsh-sales" ? "将本交接交给 dsh-sales 运行 sales_commercial_handoff_review。" : "将商业约束带回 dsh-product 的范围、包装和决策门。"] : ["补齐价格底线、成本、盈利证据或风险处置，再进入正式报价、产品范围或渠道决策。"];
	const profitabilitySummary = input.profitability ? {
		status: input.profitability.status,
		revenue: input.profitability.totals.revenue,
		contribution: input.profitability.totals.contribution,
		profit: input.profitability.totals.profit,
		profitMarginPct: input.profitability.totals.profitMarginPct
	} : void 0;
	const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
	const artifactId = createArtifactId({
		artifactType: "commercial-handoff",
		productName: input.productName,
		handoffTo: input.handoffTo,
		currency: input.pricing.currency,
		offers,
		profitabilitySummary,
		status,
		decision
	});
	const handoff = {
		schemaVersion: "1.0",
		artifactId,
		handoffVersion: "1.0",
		artifactType: "commercial-handoff",
		handoffFrom: "dsh-business",
		handoffTo: input.handoffTo,
		generatedAt,
		status,
		decision,
		productName: input.productName,
		currency: input.pricing.currency,
		offers,
		...profitabilitySummary ? { profitabilitySummary } : {},
		risks,
		requiredApprovals,
		source: input.source,
		warnings,
		nextActions,
		markdown: ""
	};
	handoff.markdown = [
		"---",
		"schemaVersion: \"1.0\"",
		`artifactId: ${JSON.stringify(artifactId)}`,
		"handoffVersion: \"1.0\"",
		"artifactType: commercial-handoff",
		"handoffFrom: dsh-business",
		`handoffTo: ${input.handoffTo}`,
		`status: ${status}`,
		`decision: ${decision}`,
		`productName: ${JSON.stringify(input.productName)}`,
		`currency: ${JSON.stringify(input.pricing.currency)}`,
		...input.source ? [`source: ${JSON.stringify(input.source)}`] : [],
		"---",
		`# ${input.productName} 商业交接`,
		"",
		"> 本材料是计算事实和待审批项，不是价格批准、折扣授权或收入承诺。",
		"",
		"## 报价事实",
		"",
		"| SKU | 渠道 | 有效成交价 | 最低成交价 | 单位成本 | 单位贡献 | 贡献毛利率 | 状态 |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
		...offers.map((offer) => `| ${offer.sku} | ${offer.channel} | ${money(offer.effectivePrice)} | ${offer.minimumTransactionPrice === void 0 ? "缺失" : money(offer.minimumTransactionPrice)} | ${money(offer.unitCost)} | ${money(offer.contributionPerUnit)} | ${money(offer.contributionMarginPct)}% | ${offer.status} |`),
		"",
		"## 盈利摘要",
		handoff.profitabilitySummary ? `- 状态：${handoff.profitabilitySummary.status}\n- 收入：${money(handoff.profitabilitySummary.revenue)}\n- 贡献：${money(handoff.profitabilitySummary.contribution)}\n- 利润：${money(handoff.profitabilitySummary.profit)}\n- 利润率：${money(handoff.profitabilitySummary.profitMarginPct)}%` : "- 未提供盈利复盘。",
		"",
		"## 风险",
		markdownList(risks),
		"",
		"## 必须由负责人确认",
		markdownList(requiredApprovals),
		"",
		"## 警告与下一步",
		markdownList(warnings),
		markdownList(nextActions),
		""
	].join("\n");
	return handoff;
}

//#endregion
//#region src/context.ts
function childPath(parent, name$1) {
	return `${parent.replace(/[\\/]+$/, "")}\\${name$1}`;
}
function frontmatter(text$1) {
	const match = text$1.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	return Object.fromEntries((match[1] ?? "").split(/\r?\n/).flatMap((line) => {
		const index = line.indexOf(":");
		return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]] : [];
	}));
}
function artifactType(path, content, meta) {
	if (meta.artifactType) return meta.artifactType;
	if (/pricing|定价|报价/i.test(path + content)) return "business-pricing-review";
	if (/profitability|盈利|利润/i.test(path + content)) return "business-profitability-review";
	if (/commercial|商业交接/i.test(path + content)) return "commercial-handoff";
	return "business-note";
}
function auditBusinessNote(path, content) {
	const meta = frontmatter(content);
	const missing = [
		"type",
		"status",
		"owner",
		"updated",
		"source"
	].filter((key) => !meta[key]);
	const type = artifactType(path, content, meta);
	const status = missing.length === 0 ? "ready" : missing.length <= 2 ? "partial" : "blocked";
	return {
		path,
		artifactType: type,
		status,
		missing,
		warnings: missing.length > 0 ? ["商业结论缺少完整来源和责任信息，不能直接作为审批依据。"] : [],
		nextActions: status === "ready" ? ["将事实、假设、风险和审批边界带入 business_commercial_handoff。"] : [`补齐字段：${missing.join("、")}。`]
	};
}
async function scanBusinessVault(fs, config, root, signal) {
	const files = [];
	const dataFiles = [];
	const errors = [];
	const walk = async (path, target) => {
		if (files.length >= config.maxFiles) return;
		let entries;
		try {
			entries = await fs.listDir(target, signal);
		} catch (error) {
			errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		for (const entry of entries) {
			if (files.length >= config.maxFiles) break;
			const child = childPath(path, entry.name);
			if (entry.type === "directory") {
				if (!entry.name.startsWith(".")) await walk(child, entry.target);
				continue;
			}
			const size = entry.size ?? 0;
			const ext = entry.name.match(/\.[^.]+$/)?.[0].toLowerCase() ?? "";
			if (![
				".md",
				".markdown",
				".csv",
				".json",
				".jsonl",
				".ndjson"
			].includes(ext)) {
				files.push({
					path: child,
					type: ext || "file",
					size,
					status: "skipped",
					reasons: ["unsupported extension"]
				});
				continue;
			}
			if (size > config.maxFileBytes) {
				files.push({
					path: child,
					type: ext,
					size,
					status: "skipped",
					reasons: [`exceeds maxFileBytes (${config.maxFileBytes})`]
				});
				continue;
			}
			try {
				if (ext === ".md" || ext === ".markdown") {
					const audit = auditBusinessNote(child, await fs.readText(entry.target, signal));
					files.push({
						path: child,
						type: ext,
						size,
						artifactType: audit.artifactType,
						status: "supported",
						reasons: audit.missing
					});
				} else {
					dataFiles.push(child);
					files.push({
						path: child,
						type: ext,
						size,
						status: "supported",
						reasons: []
					});
				}
			} catch (error) {
				files.push({
					path: child,
					type: ext,
					size,
					status: "error",
					reasons: [error instanceof Error ? error.message : String(error)]
				});
				errors.push(`${child}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	};
	await walk(root, await fs.resolve(root, { signal }));
	return {
		root,
		files,
		supportedNotes: files.filter((file) => file.artifactType).length,
		dataFiles,
		errors
	};
}

//#endregion
//#region src/output.ts
const resultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		schemaVersion: { type: "string" },
		ok: { type: "boolean" },
		data: { type: "json" },
		warnings: {
			type: "array",
			items: { type: "string" }
		},
		assumptions: {
			type: "array",
			items: { type: "string" }
		},
		lineage: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: true
			}
		},
		nextActions: {
			type: "array",
			items: { type: "string" }
		}
	}
};
function resultEnvelope(options) {
	return {
		schemaVersion: "1.0",
		ok: true,
		data: options.data,
		warnings: [...options.warnings ?? []],
		assumptions: [...options.assumptions ?? []],
		lineage: [...options.lineage ?? []],
		nextActions: [...options.nextActions ?? []]
	};
}
function jsonValue(value) {
	return JSON.parse(JSON.stringify(value));
}
function renderResult(value, maxChars) {
	const text$1 = JSON.stringify(value, null, 2);
	return [{
		type: "text",
		text: text$1.length > maxChars ? `${text$1.slice(0, maxChars)}\n... result truncated by dsh-business ...` : text$1
	}];
}

//#endregion
//#region src/tools.ts
function businessOutput(maxChars) {
	return {
		schema: resultSchema,
		render: (_args, value) => renderResult(value, maxChars)
	};
}
function lineageFromValue(value) {
	const sources = /* @__PURE__ */ new Set();
	if (typeof value === "object" && value !== null) {
		const record$1 = value;
		if (typeof record$1.source === "string" && record$1.source.trim()) sources.add(record$1.source.trim());
		if (Array.isArray(record$1.evidence)) {
			for (const item of record$1.evidence) if (typeof item === "object" && item !== null && typeof item.source === "string") {
				const source = String(item.source).trim();
				if (source) sources.add(source);
			}
		}
	}
	return [...sources].map((source) => ({ source }));
}
function wrapResult(value, options = {}) {
	const warnings = typeof value === "object" && value !== null && "warnings" in value && Array.isArray(value.warnings) ? value.warnings.filter((warning) => typeof warning === "string") : [];
	return resultEnvelope({
		data: jsonValue(attachArtifactMetadata(value, { staleAfterDays: 90 })),
		warnings,
		assumptions: options.assumptions,
		lineage: options.lineage ?? lineageFromValue(value),
		nextActions: options.nextActions
	});
}
function stringList(value, label) {
	if (!value?.trim()) return [];
	const trimmed = value.trim();
	try {
		if (trimmed.startsWith("[")) {
			const parsed = JSON.parse(trimmed);
			if (!Array.isArray(parsed)) throw new Error("Expected an array.");
			return parsed.map((item) => String(item).trim()).filter(Boolean);
		}
	} catch (error) {
		throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
	return trimmed.split(/\r?\n|\s*;\s*|\s*\|\s*/).map((item) => item.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
}
function optionalNumber(record$1, key) {
	const value = record$1[key];
	if (value === void 0 || value === null || value === "") return void 0;
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) throw new Error(`${key} must be a finite number.`);
	return number;
}
function requiredNumber(record$1, key) {
	return optionalNumber(record$1, key) ?? 0;
}
function evidenceFromJson(value) {
	if (!value?.trim()) return [];
	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("evidence must be a JSON array.");
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null) throw new Error(`evidence[${index}] must be an object.`);
		const record$1 = item;
		const status = String(record$1.status ?? "missing");
		if (![
			"fact",
			"assumption",
			"missing"
		].includes(status)) throw new Error(`evidence[${index}].status is invalid.`);
		const label = String(record$1.label ?? record$1.name ?? "").trim();
		if (!label) throw new Error(`evidence[${index}].label is required.`);
		return {
			id: String(record$1.id ?? `E${index + 1}`),
			label,
			status,
			evidence: record$1.evidence === void 0 || record$1.evidence === null ? void 0 : String(record$1.evidence),
			source: record$1.source === void 0 || record$1.source === null ? void 0 : String(record$1.source)
		};
	});
}
function offersFromJson(value) {
	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("offers must be a JSON array.");
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null) throw new Error(`offers[${index}] must be an object.`);
		const record$1 = item;
		const sku = String(record$1.sku ?? "").trim();
		const channel = String(record$1.channel ?? "").trim();
		if (!sku || !channel) throw new Error(`offers[${index}] requires sku and channel.`);
		return {
			sku,
			channel,
			listPrice: requiredNumber(record$1, "listPrice"),
			transactionPrice: optionalNumber(record$1, "transactionPrice"),
			supplyPrice: optionalNumber(record$1, "supplyPrice"),
			unitCost: requiredNumber(record$1, "unitCost"),
			commissionRate: optionalNumber(record$1, "commissionRate"),
			discountRate: optionalNumber(record$1, "discountRate"),
			logisticsPerUnit: optionalNumber(record$1, "logisticsPerUnit"),
			otherVariableCostPerUnit: optionalNumber(record$1, "otherVariableCostPerUnit"),
			minimumTransactionPrice: optionalNumber(record$1, "minimumTransactionPrice"),
			targetContributionMargin: optionalNumber(record$1, "targetContributionMargin"),
			volume: optionalNumber(record$1, "volume")
		};
	});
}
function profitabilityLinesFromJson(value) {
	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed)) throw new Error("lines must be a JSON array.");
	return parsed.map((item, index) => {
		if (typeof item !== "object" || item === null) throw new Error(`lines[${index}] must be an object.`);
		const record$1 = item;
		const name$1 = String(record$1.name ?? "").trim();
		if (!name$1) throw new Error(`lines[${index}].name is required.`);
		return {
			name: name$1,
			units: requiredNumber(record$1, "units"),
			revenuePerUnit: requiredNumber(record$1, "revenuePerUnit"),
			variableCostPerUnit: requiredNumber(record$1, "variableCostPerUnit"),
			fixedCost: optionalNumber(record$1, "fixedCost"),
			otherRevenue: optionalNumber(record$1, "otherRevenue"),
			otherCost: optionalNumber(record$1, "otherCost")
		};
	});
}
function objectFromJson(value, label) {
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	const data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "data" in parsed ? parsed.data : parsed;
	if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error(`${label} must be a JSON object or result envelope.`);
	return data;
}
function pricingReviewFromJson(value) {
	const data = objectFromJson(value, "pricingJson");
	if (data.artifactType !== "business-pricing-review" || !Array.isArray(data.offers)) throw new Error("pricingJson must contain a business_pricing_review result.");
	return data;
}
function profitabilityReviewFromJson(value) {
	const data = objectFromJson(value, "profitabilityJson");
	if (data.artifactType !== "business-profitability-review" || typeof data.totals !== "object" || data.totals === null) throw new Error("profitabilityJson must contain a business_profitability_review result.");
	return data;
}
async function ensureInsideRoot(fs, config, path, signal) {
	const root = await fs.resolve(config.defaultRoot, { signal });
	const target = await fs.resolve(path, { signal });
	if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${path}`);
}
function registerBusinessTools(ctx, config, fs) {
	ctx.tools.register(defineTool({
		name: "business_onboarding",
		description: "Run a read-only business readiness scan over local Markdown, CSV and JSON evidence. It identifies commercial inputs and missing source/owner metadata before calculation.",
		parameters: { root: {
			type: "string",
			description: "Optional directory under defaultRoot."
		} },
		output: businessOutput(config.maxResultChars),
		async execute(args, exec) {
			const root = args.root?.trim() || config.defaultRoot;
			await ensureInsideRoot(fs, config, root, exec.signal);
			const scan = await scanBusinessVault(fs, config, root, exec.signal);
			const status = scan.supportedNotes > 0 || scan.dataFiles.length > 0 ? scan.errors.length > 0 ? "partial" : "ready" : "blocked";
			const result = {
				artifactType: "business-onboarding",
				generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				root,
				status,
				scan,
				warnings: scan.errors,
				nextActions: status === "ready" ? ["运行 business_audit_note 检查关键材料，再运行 business_pricing_review/business_profitability_review。"] : ["补充产品、价格、成本或销售反馈资料，再运行 onboarding。"]
			};
			return wrapResult(result, {
				lineage: [{ source: root }],
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_audit_note",
		description: "Audit one local business Markdown note for artifact type, status, owner, updated date, source and approval boundary. It never treats a complete template as approval.",
		parameters: { path: {
			type: "string",
			required: true,
			description: "Business Markdown artifact under defaultRoot."
		} },
		output: businessOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			const target = await fs.resolve(args.path, { signal: exec.signal });
			const info = await fs.stat(target, exec.signal);
			if (!info || info.type !== "file") throw new Error(`File not found: ${args.path}`);
			const content = await fs.readText(target, exec.signal);
			if (content.length > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars})`);
			const result = auditBusinessNote(args.path, content);
			return wrapResult(result, {
				lineage: [{ source: args.path }],
				nextActions: result.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_apply_artifact",
		description: "Preview or apply a business Markdown artifact under defaultRoot using explicit confirmation and a version guard.",
		parameters: {
			path: {
				type: "string",
				required: true
			},
			content: {
				type: "string",
				required: true
			},
			confirm: {
				type: "boolean",
				required: true,
				description: "false previews only; true applies the guarded write."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args, exec) {
			await ensureInsideRoot(fs, config, args.path, exec.signal);
			const target = await fs.resolve(args.path, { signal: exec.signal });
			const info = await fs.stat(target, exec.signal);
			if (!info || info.type !== "file") throw new Error(`File not found: ${args.path}`);
			const current = await fs.readText(target, exec.signal);
			const diff = {
				beforeLines: current.split(/\r?\n/).length,
				afterLines: args.content.split(/\r?\n/).length,
				changed: current !== args.content
			};
			if (!args.confirm) return wrapResult({
				status: "preview-only",
				path: args.path,
				applied: false,
				diff
			}, { nextActions: ["审阅 diff；确认后再次调用并设置 confirm=true。"] });
			await fs.writeText(target, args.content, {
				kind: "replaceIfVersion",
				version: info.version
			}, exec.signal);
			let audit;
			try {
				audit = await appendArtifactAudit(fs, config.defaultRoot, {
					action: "apply",
					path: args.path,
					beforeHash: contentHash(current),
					afterHash: contentHash(args.content),
					approved: true
				}, exec.signal);
			} catch (error) {
				audit = {
					status: "audit-failed",
					warning: error instanceof Error ? error.message : String(error)
				};
			}
			return wrapResult({
				status: "applied",
				path: args.path,
				applied: true,
				guarded: true,
				diff,
				audit
			}, { lineage: [{ source: args.path }] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_handoff_receive",
		description: "Receive a supported upstream artifact with integrity, routing and evidence checks. Produce an owned, dated receipt for one initiative; acceptance is not approval or task completion. Read-only.",
		parameters: handoffParameters,
		output: businessOutput(config.maxResultChars),
		async execute(args, exec) {
			exec.signal.throwIfAborted();
			const receipt = receiveHandoff(JSON.parse(args.artifactJson), args);
			return wrapResult(receipt, { nextActions: receipt.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_artifact_review",
		description: "Validate a business artifact before handing it to another plugin. Checks schema, stable ID, source hash and evidence freshness without changing files.",
		parameters: {
			artifactJson: {
				type: "string",
				required: true,
				description: "JSON returned by a plugin tool."
			},
			expectedType: {
				type: "string",
				description: "Optional expected artifactType."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args) {
			let value;
			try {
				value = JSON.parse(args.artifactJson);
			} catch (error) {
				throw new Error(`artifactJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
			}
			const review = reviewArtifact(typeof value === "object" && value !== null && "data" in value ? value.data : value, args.expectedType?.trim() || void 0);
			return wrapResult({
				artifactType: "business-artifact-review",
				generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				...review
			}, { nextActions: review.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_loop_review",
		description: "Review the six-plugin business loop from supplied artifacts. It identifies missing gates and does not treat document existence as business validation.",
		parameters: {
			initiativeId: {
				type: "string",
				required: true,
				description: "Shared business initiative ID for all receiving receipts."
			},
			artifactsJson: {
				type: "string",
				description: "Optional JSON array of artifacts or result envelopes. If omitted, the plugin scans root for local artifact files."
			},
			root: {
				type: "string",
				description: "Optional project root to scan when artifactsJson is omitted."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args, exec) {
			let artifacts;
			let index;
			if (args.artifactsJson?.trim()) {
				let parsed;
				try {
					parsed = JSON.parse(args.artifactsJson);
				} catch (error) {
					throw new Error(`artifactsJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
				}
				if (!Array.isArray(parsed)) throw new Error("artifactsJson must be a JSON array.");
				artifacts = parsed;
			} else {
				const root = args.root?.trim() || config.defaultRoot;
				await ensureInsideRoot(fs, config, root, exec.signal);
				index = await indexArtifacts(fs, root, config.maxFiles, config.maxTextChars, exec.signal, true);
				artifacts = index.artifacts.map((item) => item.value ?? item);
			}
			const result = reviewLoopArtifacts(artifacts, args.initiativeId);
			if (index) result.warnings.push(...index.warnings);
			return wrapResult(result, { nextActions: result.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_artifact_index",
		description: "Scan a local project root for structured Markdown/JSON artifacts and report their IDs, types, freshness and validation status. Skips docs, hidden directories, node_modules and generated lib files.",
		parameters: { root: {
			type: "string",
			description: "Optional project root under defaultRoot."
		} },
		output: businessOutput(config.maxResultChars),
		async execute(args, exec) {
			const root = args.root?.trim() || config.defaultRoot;
			await ensureInsideRoot(fs, config, root, exec.signal);
			const index = await indexArtifacts(fs, root, config.maxFiles, config.maxTextChars, exec.signal);
			return wrapResult({
				artifactType: "business-artifact-index",
				generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				...index,
				nextActions: index.artifacts.length > 0 ? ["把需要交接的最新 artifactId 传给对应插件的 *_artifact_review。"] : ["先运行 idea/product/business/geo/growth/sales 工具生成结构化工件。"]
			}, { lineage: [{ source: root }] });
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_model_review",
		description: "Review a business model across customer, value proposition, revenue streams, pricing model, channels, cost drivers and evidence. It distinguishes a missing business case from a disproved one.",
		parameters: {
			businessName: {
				type: "string",
				required: true,
				description: "Business or product name."
			},
			targetCustomer: {
				type: "string",
				required: true,
				description: "Target customer or buyer."
			},
			valueProposition: {
				type: "string",
				required: true,
				description: "Customer value delivered."
			},
			revenueStreams: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated revenue streams."
			},
			pricingModel: {
				type: "string",
				required: true,
				description: "Pricing or charging model."
			},
			channels: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated acquisition/distribution channels."
			},
			costDrivers: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated cost drivers."
			},
			evidence: {
				type: "string",
				description: "Optional JSON array of {id,label,status,evidence,source}; status is fact, assumption or missing."
			},
			fitStatus: {
				type: "string",
				description: "Optional fit assessment: promising, uncertain or disproved."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args) {
			const fitStatus = args.fitStatus?.trim();
			if (fitStatus && ![
				"promising",
				"uncertain",
				"disproved"
			].includes(fitStatus)) throw new Error("fitStatus must be promising, uncertain or disproved.");
			const review = buildBusinessModelReview({
				businessName: args.businessName,
				targetCustomer: args.targetCustomer,
				valueProposition: args.valueProposition,
				revenueStreams: stringList(args.revenueStreams, "revenueStreams"),
				pricingModel: args.pricingModel,
				channels: stringList(args.channels, "channels"),
				costDrivers: stringList(args.costDrivers, "costDrivers"),
				evidence: evidenceFromJson(args.evidence),
				fitStatus
			});
			return wrapResult(review, {
				assumptions: review.assumptions,
				nextActions: review.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_pricing_review",
		description: "Review price architecture and channel economics. Calculates effective price, gross margin, contribution margin, minimum transaction price violations and cross-channel price conflicts.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product or SKU portfolio name."
			},
			currency: {
				type: "string",
				description: "Currency code; defaults to configured currency."
			},
			offers: {
				type: "string",
				required: true,
				description: "JSON array of offers with sku, channel, listPrice, unitCost and optional transactionPrice, supplyPrice, commissionRate, discountRate, logisticsPerUnit, minimumTransactionPrice, targetContributionMargin and volume."
			},
			priceGapWarningPct: {
				type: "number",
				description: "Cross-channel effective-price spread warning threshold; defaults to 15."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args) {
			const review = buildBusinessPricingReview({
				productName: args.productName,
				currency: args.currency?.trim() || config.defaultCurrency,
				offers: offersFromJson(args.offers),
				priceGapWarningPct: args.priceGapWarningPct
			});
			return wrapResult(review, {
				assumptions: review.assumptions,
				nextActions: review.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_commercial_handoff",
		description: "Turn a business_pricing_review and optional business_profitability_review into a versioned commercial-handoff for dsh-sales or dsh-product. It preserves calculated facts and risks but never grants price approval, discount authority or a revenue commitment.",
		parameters: {
			productName: {
				type: "string",
				required: true,
				description: "Product or offer portfolio name."
			},
			handoffTo: {
				type: "string",
				required: true,
				enum: ["dsh-sales", "dsh-product"],
				description: "Intended consumer of the commercial constraints."
			},
			pricingJson: {
				type: "string",
				required: true,
				description: "JSON returned by business_pricing_review, including its result envelope or data object."
			},
			profitabilityJson: {
				type: "string",
				description: "Optional JSON returned by business_profitability_review."
			},
			source: {
				type: "string",
				description: "Source artifact path or approval record path."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args) {
			const handoff = buildCommercialHandoff({
				productName: args.productName,
				handoffTo: args.handoffTo,
				pricing: pricingReviewFromJson(args.pricingJson),
				profitability: args.profitabilityJson ? profitabilityReviewFromJson(args.profitabilityJson) : void 0,
				source: args.source
			});
			return wrapResult(handoff, {
				lineage: args.source ? [{ source: args.source }] : [],
				nextActions: handoff.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_profitability_review",
		description: "Review profitability by product, channel or business line. Calculates revenue, variable cost, contribution, total cost, profit and margins; it does not claim accounting net profit without tax, returns, bad-debt and cash data.",
		parameters: {
			businessName: {
				type: "string",
				required: true,
				description: "Business name."
			},
			currency: {
				type: "string",
				description: "Currency code; defaults to configured currency."
			},
			lines: {
				type: "string",
				required: true,
				description: "JSON array of {name,units,revenuePerUnit,variableCostPerUnit,fixedCost,otherRevenue,otherCost}."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args) {
			const review = buildBusinessProfitabilityReview({
				businessName: args.businessName,
				currency: args.currency?.trim() || config.defaultCurrency,
				lines: profitabilityLinesFromJson(args.lines)
			});
			return wrapResult(review, {
				assumptions: review.assumptions,
				nextActions: review.nextActions
			});
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_elevator_pitch",
		description: "Create 30-second, 60-second and 2-minute elevator pitches from customer, problem, solution, differentiation, proof and ask. It marks missing evidence instead of inventing traction.",
		parameters: {
			businessName: {
				type: "string",
				required: true,
				description: "Business or product name."
			},
			targetCustomer: {
				type: "string",
				required: true,
				description: "Who the business serves."
			},
			problem: {
				type: "string",
				required: true,
				description: "Important customer problem."
			},
			solution: {
				type: "string",
				required: true,
				description: "What the business provides."
			},
			differentiation: {
				type: "string",
				description: "Why this is different or better."
			},
			proof: {
				type: "string",
				description: "Evidence such as usage, paid customers, retention, savings or outcomes."
			},
			ask: {
				type: "string",
				description: "What the listener should do next."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args) {
			const pitch = buildElevatorPitch({
				businessName: args.businessName,
				targetCustomer: args.targetCustomer,
				problem: args.problem,
				solution: args.solution,
				differentiation: args.differentiation,
				proof: args.proof,
				ask: args.ask
			});
			return wrapResult(pitch, { nextActions: pitch.nextActions });
		}
	}));
	ctx.tools.register(defineTool({
		name: "business_plan",
		description: "Generate an evidence-aware business plan covering executive summary, customer, problem, value proposition, market, business model, pricing, channels, go-to-market, operations, metrics, milestones and risks.",
		parameters: {
			businessName: {
				type: "string",
				required: true,
				description: "Business or product name."
			},
			executiveSummary: {
				type: "string",
				description: "Optional answer-first executive summary."
			},
			customer: {
				type: "string",
				required: true,
				description: "Target customer or buyer."
			},
			problem: {
				type: "string",
				required: true,
				description: "Customer problem."
			},
			valueProposition: {
				type: "string",
				required: true,
				description: "Customer value proposition."
			},
			market: {
				type: "string",
				required: true,
				description: "Market, segment and demand context."
			},
			businessModel: {
				type: "string",
				required: true,
				description: "How the business creates, delivers and captures value."
			},
			pricing: {
				type: "string",
				required: true,
				description: "Pricing architecture or charging approach."
			},
			channels: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated channels."
			},
			goToMarket: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated go-to-market actions."
			},
			operations: {
				type: "string",
				description: "JSON array or newline-separated operating capabilities."
			},
			metrics: {
				type: "string",
				required: true,
				description: "JSON array or newline-separated success metrics."
			},
			milestones: {
				type: "string",
				description: "JSON array or newline-separated milestones."
			},
			risks: {
				type: "string",
				description: "JSON array or newline-separated risks and mitigations."
			}
		},
		output: businessOutput(config.maxResultChars),
		async execute(args) {
			const plan = buildBusinessPlan({
				businessName: args.businessName,
				executiveSummary: args.executiveSummary,
				customer: args.customer,
				problem: args.problem,
				valueProposition: args.valueProposition,
				market: args.market,
				businessModel: args.businessModel,
				pricing: args.pricing,
				channels: stringList(args.channels, "channels"),
				goToMarket: stringList(args.goToMarket, "goToMarket"),
				operations: stringList(args.operations, "operations"),
				metrics: stringList(args.metrics, "metrics"),
				milestones: stringList(args.milestones, "milestones"),
				risks: stringList(args.risks, "risks")
			});
			return wrapResult(plan, {
				assumptions: plan.assumptions,
				nextActions: plan.nextActions
			});
		}
	}));
	ctx.logger.info(`[dsh-business] registered business strategy tools with default currency ${config.defaultCurrency}`);
}

//#endregion
//#region src/contract.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateSuiteResultEnvelope(value) {
	const issues = [];
	if (!isRecord(value)) return {
		ok: false,
		issues: [{
			field: "root",
			message: "结果必须是 JSON object。"
		}],
		nextActions: ["返回 schemaVersion、ok、data、warnings、assumptions、lineage 和 nextActions。"]
	};
	if (value.schemaVersion !== "1.0") issues.push({
		field: "schemaVersion",
		message: "必须为 1.0。"
	});
	if (value.ok !== true) issues.push({
		field: "ok",
		message: "必须为 true；失败结果需要由调用方明确处理。"
	});
	for (const field of [
		"warnings",
		"assumptions",
		"lineage",
		"nextActions"
	]) if (!Array.isArray(value[field])) issues.push({
		field,
		message: "必须是数组。"
	});
	return {
		ok: issues.length === 0,
		issues,
		nextActions: issues.length === 0 ? ["继续按 data、lineage 和 nextActions 消费，不要忽略 warnings。"] : ["补齐统一结果外层后再交给下游插件。"]
	};
}
function validateSuiteArtifact(value, expected = {}) {
	const issues = [];
	if (!isRecord(value)) return {
		ok: false,
		issues: [{
			field: "root",
			message: "工件必须是 JSON object。"
		}],
		nextActions: ["返回 schemaVersion、artifactId 和 artifactType。"]
	};
	if (value.schemaVersion !== "1.0") issues.push({
		field: "schemaVersion",
		message: "必须为 1.0。"
	});
	if (typeof value.artifactId !== "string" || !value.artifactId.trim()) issues.push({
		field: "artifactId",
		message: "必须是稳定、可追踪的非空字符串。"
	});
	if (typeof value.artifactType !== "string" || !value.artifactType.trim()) issues.push({
		field: "artifactType",
		message: "必须标识工件用途。"
	});
	if (expected.artifactType && value.artifactType !== expected.artifactType) issues.push({
		field: "artifactType",
		message: `应为 ${expected.artifactType}。`
	});
	if (expected.handoffFrom && value.handoffFrom !== expected.handoffFrom) issues.push({
		field: "handoffFrom",
		message: `应为 ${expected.handoffFrom}。`
	});
	if (expected.handoffTo && value.handoffTo !== expected.handoffTo) issues.push({
		field: "handoffTo",
		message: `应为 ${expected.handoffTo}。`
	});
	return {
		ok: issues.length === 0,
		issues,
		nextActions: issues.length === 0 ? ["保留来源、证据和下一步，再交给目标插件。"] : ["修复契约字段或停止交接；不要靠缺失字段推断业务结论。"]
	};
}

//#endregion
//#region src/index.ts
const name = "dsh-business";
const inject = ["tools", "fs"];
const Config = Schema.object({
	defaultRoot: Schema.string().default("."),
	defaultCurrency: Schema.string().default("CNY"),
	defaultLanguage: Schema.string().default("zh-CN"),
	maxResultChars: Schema.number().step(1).min(1e3).max(2e5).default(5e4),
	maxFiles: Schema.number().step(1).min(1).max(5e3).default(500),
	maxFileBytes: Schema.number().step(1).min(1024).max(10485760).default(1048576),
	maxTextChars: Schema.number().step(1).min(1e3).max(1e6).default(18e4)
});
function apply(ctx, config) {
	const fs = ctx.fs;
	registerBusinessTools(ctx, config, fs);
}

//#endregion
export { Config, apply, inject, name, validateSuiteArtifact, validateSuiteResultEnvelope };