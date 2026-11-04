/** JSON wire contract. Decimal scores are serialized as strings by Prisma. */
export type V11ContentScore = number | string | null;
export type V11FactClaim = { key: string; state: string; evidenceReferences?: string[] };
export type V11ContentEvidence = { startSeconds: number | null; endSeconds: number | null; reference?: string | null; description: string };
export type V11ContentDiagnostic = {
  dimension: string;
  weight: number;
  adoptedAnchor: number | null;
  score: number | null;
  status: string;
  representativeRunId: string | null;
  observation: string | null;
  facts: string[];
  factClaims: V11FactClaim[];
  evidence: V11ContentEvidence[];
  improvementSuggestions: string[] | null;
};
export type V11ContentDiagnostics = {
  dimensions: V11ContentDiagnostic[];
  directorSummary: {
    strengths: Array<Pick<V11ContentDiagnostic, 'dimension' | 'score' | 'observation'>>;
    priorities: Array<V11ContentDiagnostic & { priority: string }>;
    stableMessage: string | null;
  };
};
export type V11ContentRunBase = {
  id: string; runNumber: number; runRole: string; status: string;
  totalScore: V11ContentScore; contentRating: string | null; stale: boolean;
  complianceStatus: string | null; completedAt: string | null;
};
export type V11AdminContentRun = V11ContentRunBase & {
  modelProvider: string; modelName: string; promptVersion: string; schemaVersion: string;
  rubricVersion: string; factClaimVersion: string | null; structuredOutput: unknown;
};
export type V11PublicContentRun = V11ContentRunBase & {
  modelProvider?: never; modelName?: never; promptVersion?: never; schemaVersion?: never;
  rubricVersion?: never; factClaimVersion?: never; structuredOutput?: never;
};
export type V11ContentRun = V11AdminContentRun | V11PublicContentRun;
type V11ContentGroupBase = {
  status: string; shadowMode: boolean; pilotRun?: boolean; independent?: boolean;
  decision: null | {
    id: string; totalScore: V11ContentScore; contentRating: string | null; complianceStatus: string;
    inputComplete: boolean; stable: boolean; decisionSource: string; adoptionMethod: string;
  };
  workflowRevision: { revision: number; status?: string } | null;
};
export type V11AdminContentGroup = V11ContentGroupBase & {
  inputRevision: { factClaimVersion: string | null } | null;
  runs: V11AdminContentRun[];
};
export type V11PublicContentGroup = V11ContentGroupBase & {
  inputRevision?: never;
  runs: V11PublicContentRun[];
};
export type V11ContentGroup = V11AdminContentGroup | V11PublicContentGroup;
export type V11ContentLatestResponse<Group = V11ContentGroup | null> = {
  shadowMode: boolean;
  group: Group;
  diagnostics: V11ContentDiagnostics | null;
};
export type V11AdminContentLatestResponse = V11ContentLatestResponse<V11AdminContentGroup | null>;
export type V11PublicContentLatestResponse = V11ContentLatestResponse<V11PublicContentGroup | null>;
