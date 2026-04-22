import {
  getCanonicalJmaParserConfig,
  getCanonicalJmaParserProvenance,
  getCanonicalJmaStateDefinition,
  type JmaCanonicalStateDefinition,
  type JmaParserConfig,
  type JmaParserProvenance,
  type JmaRecommendationCheck,
  type JmaSeverity,
  type JmaWorkflowRecommendation,
} from './jma-parser-config';

export type {
  JmaParserAnchorStrategy,
  JmaParserEvidenceField,
  JmaParserEvidenceKey,
  JmaParserProvenance,
  JmaParserTimestampSource,
  JmaParserValidationValue,
} from './jma-parser-config';

export type { JmaRecommendationCheck, JmaSeverity, JmaWorkflowRecommendation } from './jma-parser-config';

export interface JmaRecommendation {
  code: number;
  label: string;
  title: string;
  summary: string;
  implication: string;
  severity: JmaSeverity;
  checks: JmaRecommendationCheck[];
  remediation: string[];
  workflowRecommendation: JmaWorkflowRecommendation;
  workflowNote: string;
  parser?: JmaParserConfig;
  parserProvenance?: JmaParserProvenance | null;
}

function toRecommendation(definition: JmaCanonicalStateDefinition): JmaRecommendation {
  return {
    code: definition.code,
    label: definition.label,
    title: definition.title,
    summary: definition.summary,
    implication: definition.implication,
    severity: definition.severity,
    checks: definition.checks,
    remediation: definition.remediation,
    workflowRecommendation: definition.workflowRecommendation,
    workflowNote: definition.workflowNote,
    ...(definition.parserConfig ? { parser: definition.parserConfig } : {}),
    parserProvenance: definition.parserProvenance,
  };
}

export function getJmaRecommendation(code: number | null): JmaRecommendation | null {
  const definition = getCanonicalJmaStateDefinition(code);
  return definition ? toRecommendation(definition) : null;
}

export function getJmaParserConfig(code: number | null): JmaParserConfig | null {
  return getCanonicalJmaParserConfig(code);
}

export function getJmaParserProvenance(code: number | null): JmaParserProvenance | null {
  return getCanonicalJmaParserProvenance(code);
}
