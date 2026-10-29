import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";

//#region src/tools.d.ts
interface BusinessConfig {
  defaultRoot: string;
  defaultCurrency: string;
  defaultLanguage: string;
  maxResultChars: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTextChars: number;
}
//#endregion
//#region src/contract.d.ts
interface SuiteContractIssue {
  field: string;
  message: string;
}
interface SuiteContractReview {
  ok: boolean;
  issues: SuiteContractIssue[];
  nextActions: string[];
}
declare function validateSuiteResultEnvelope(value: unknown): SuiteContractReview;
declare function validateSuiteArtifact(value: unknown, expected?: {
  artifactType?: string;
  handoffFrom?: string;
  handoffTo?: string;
}): SuiteContractReview;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-business";
declare const inject: string[];
type Config = BusinessConfig;
declare const Config: Schema<BusinessConfig>;
declare function apply(ctx: Context, config: BusinessConfig): void;
//#endregion
export { Config, apply, inject, name, validateSuiteArtifact, validateSuiteResultEnvelope };