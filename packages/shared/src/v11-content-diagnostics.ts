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
export type V11ContentRun = {
  id: string; runNumber: number; runRole: string; status: string;
  totalScore: V11ContentScore; contentRating: string | null; stale: boolean;
  modelProvider?: string; modelName?: string; promptVersion?: string; schemaVersion?: string;
  rubricVersion?: string; factClaimVersion?: string | null; structuredOutput?: unknown;
};
export type V11ContentGroup = {
  status: string; shadowMode: boolean; pilotRun?: boolean; independent?: boolean;
  runs: V11ContentRun[];
  decision: null | {
    id: string; totalScore: V11ContentScore; contentRating: string | null; complianceStatus: string;
    inputComplete: boolean; stable: boolean; decisionSource: string; adoptionMethod: string;
  };
  workflowRevision: { revision: number; status?: string } | null;
};
export type V11ContentLatestResponse<Group = V11ContentGroup | null> = {
  shadowMode: boolean;
  group: Group;
  diagnostics: V11ContentDiagnostics | null;
};
