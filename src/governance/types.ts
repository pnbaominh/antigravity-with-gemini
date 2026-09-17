export interface PERTEstimate {
  optimisticHours: number; // O
  mostLikelyHours: number; // M
  pessimisticHours: number; // P
  expectedHours: number; // E = (O + 4M + P) / 6
  sigmaHours: number; // sigma = (P - O) / 6
}

export type RAIDCategory = 'Risk' | 'Assumption' | 'Issue' | 'Dependency';
export type SeverityLevel = 'Critical' | 'High' | 'Medium' | 'Low';

export interface RAIDItem {
  id: string;
  category: RAIDCategory;
  description: string;
  impact: SeverityLevel;
  likelihood: SeverityLevel;
  mitigationStrategy: string;
  triggerCondition?: string;
  ownerDRI: string;
}

export interface WBSNode {
  id: string;
  title: string;
  dri: string; // Exactly 1 Directly Responsible Individual
  estimatedHours: PERTEstimate;
  dependencies: string[];
  binaryAcceptanceCriteria: string[]; // Pass/Fail criteria
  isCompleted: boolean;
}

export interface AsIsEvidence {
  filePath: string;
  lineRanges?: [number, number][];
  observation: string;
}

export interface GovernancePlanSchema {
  planId: string;
  title: string;
  dri: string;
  asIsEvidence: AsIsEvidence[];
  nonGoals: [string, string, string, ...string[]]; // At least 3 items tuple constraint
  haltOnUnknownTriggered: boolean;
  unknownsList: string[];
  raidLog: RAIDItem[];
  wbsNodes: WBSNode[];
  overallPERT?: PERTEstimate;
  definitionOfDone: string[];
}

export interface RuleValidationResult {
  valid: boolean;
  violations: string[];
  haltRequired: boolean;
}
