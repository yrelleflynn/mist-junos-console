import canonicalCloudStatusMarkdown from '../../docs/CLOUD-STATUS-CANONICAL.md?raw';

export type JmaParserTimestampSource = 'disconnect_reason' | 'mist_last_seen' | 'event_sent_transition';
export type JmaParserAnchorStrategy = 'mist_last_seen_then_event_sent' | 'event_sent_then_current' | 'current_window_only';
export type JmaParserValidationValue =
  | 'validated_in_lab'
  | 'derived_from_lab_and_prototype'
  | 'needs_more_field_validation';
export type JmaSeverity = 'fail' | 'warn' | 'info' | 'pass';
export type JmaWorkflowRecommendation = 'full' | 'targeted_then_full' | 'targeted' | 'optional' | 'skip';
export type JmaParserEvidenceKey =
  | 'management_ip'
  | 'default_gateway'
  | 'gateway_reachability'
  | 'dns_server'
  | 'mist_hostname_lookup'
  | 'fallback_dns_lookup'
  | 'fallback_resolver_probe'
  | 'resolver_library_result'
  | 'cloud_tcp_dial'
  | 'cloud_websocket_dial'
  | 'cached_cloud_endpoint'
  | 'current_cycle'
  | 'mist_last_seen'
  | 'disconnect_delivery'
  | 'mcd_conclusion';

export interface JmaParserEvidenceField {
  key: JmaParserEvidenceKey;
  label: string;
  description: string;
}

export interface JmaRecommendationCheck {
  id: string;
  label: string;
  why: string;
}

export interface JmaParserProvenance {
  formatValidation: JmaParserValidationValue;
  semanticsValidation: JmaParserValidationValue;
}

export interface JmaParserConfig {
  anchorStrategy: JmaParserAnchorStrategy;
  primaryTimestampSource: JmaParserTimestampSource;
  evidenceFields: JmaParserEvidenceField[];
}

export interface JmaCanonicalStateDefinition {
  code: number;
  label: string;
  title: string;
  summary: string;
  implication: string;
  severity: JmaSeverity;
  workflowRecommendation: JmaWorkflowRecommendation;
  workflowNote: string;
  checks: JmaRecommendationCheck[];
  remediation: string[];
  parserConfig: JmaParserConfig | null;
  parserProvenance: JmaParserProvenance | null;
}

const ANCHOR_STRATEGIES = new Set<JmaParserAnchorStrategy>([
  'mist_last_seen_then_event_sent',
  'event_sent_then_current',
  'current_window_only',
]);

const TIMESTAMP_SOURCES = new Set<JmaParserTimestampSource>([
  'disconnect_reason',
  'mist_last_seen',
  'event_sent_transition',
]);

const EVIDENCE_KEYS = new Set<JmaParserEvidenceKey>([
  'management_ip',
  'default_gateway',
  'gateway_reachability',
  'dns_server',
  'mist_hostname_lookup',
  'fallback_dns_lookup',
  'fallback_resolver_probe',
  'resolver_library_result',
  'cloud_tcp_dial',
  'cloud_websocket_dial',
  'cached_cloud_endpoint',
  'current_cycle',
  'mist_last_seen',
  'disconnect_delivery',
  'mcd_conclusion',
]);

const VALIDATION_VALUES = new Set<JmaParserValidationValue>([
  'validated_in_lab',
  'derived_from_lab_and_prototype',
  'needs_more_field_validation',
]);

const SEVERITIES = new Set<JmaSeverity>(['fail', 'warn', 'info', 'pass']);
const WORKFLOW_RECOMMENDATIONS = new Set<JmaWorkflowRecommendation>([
  'full',
  'targeted_then_full',
  'targeted',
  'optional',
  'skip',
]);

function isAnchorStrategy(value: string): value is JmaParserAnchorStrategy {
  return ANCHOR_STRATEGIES.has(value as JmaParserAnchorStrategy);
}

function isTimestampSource(value: string): value is JmaParserTimestampSource {
  return TIMESTAMP_SOURCES.has(value as JmaParserTimestampSource);
}

function isEvidenceKey(value: string): value is JmaParserEvidenceKey {
  return EVIDENCE_KEYS.has(value as JmaParserEvidenceKey);
}

function isValidationValue(value: string): value is JmaParserValidationValue {
  return VALIDATION_VALUES.has(value as JmaParserValidationValue);
}

function isSeverity(value: string): value is JmaSeverity {
  return SEVERITIES.has(value as JmaSeverity);
}

function isWorkflowRecommendation(value: string): value is JmaWorkflowRecommendation {
  return WORKFLOW_RECOMMENDATIONS.has(value as JmaWorkflowRecommendation);
}

function readScalar(yaml: string, key: string): string | null {
  const simpleMatch = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (simpleMatch) return simpleMatch[1].trim();

  const foldedMatch = yaml.match(new RegExp(`^${key}:\\s*>\\n([\\s\\S]*?)(?=^[^\\s]|\\Z)`, 'm'));
  if (!foldedMatch) return null;
  return foldedMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function parseChecks(yaml: string): JmaRecommendationCheck[] {
  const sectionMatch = yaml.match(/^checks:\n([\s\S]*?)(?=^remediation:|\Z)/m);
  if (!sectionMatch) return [];

  const lines = sectionMatch[1].split('\n');
  const checks: JmaRecommendationCheck[] = [];
  let current: Partial<JmaRecommendationCheck> | null = null;

  for (const line of lines) {
    const idMatch = line.match(/^  - id:\s+(.+)$/);
    if (idMatch) {
      if (current) {
        if (!current.id || !current.label || !current.why) {
          throw new Error('Incomplete canonical check entry.');
        }
        checks.push(current as JmaRecommendationCheck);
      }
      current = { id: idMatch[1].trim() };
      continue;
    }

    if (!current) continue;

    const labelMatch = line.match(/^    label:\s+(.+)$/);
    if (labelMatch) {
      current.label = labelMatch[1].trim();
      continue;
    }

    const whyMatch = line.match(/^    why:\s+(.+)$/);
    if (whyMatch) {
      current.why = whyMatch[1].trim();
    }
  }

  if (current) {
    if (!current.id || !current.label || !current.why) {
      throw new Error('Incomplete canonical check entry.');
    }
    checks.push(current as JmaRecommendationCheck);
  }

  return checks;
}

function parseRemediation(yaml: string): string[] {
  const sectionMatch = yaml.match(/^remediation:\n([\s\S]*?)(?=^parser:|\Z)/m);
  if (!sectionMatch) return [];

  return sectionMatch[1]
    .split('\n')
    .map((line) => line.match(/^  -\s+(.+)$/)?.[1]?.trim() ?? null)
    .filter((value): value is string => Boolean(value));
}

function parseStateParserConfigs(markdown: string): Map<number, JmaCanonicalStateDefinition> {
  const configs = new Map<number, JmaCanonicalStateDefinition>();
  const stateBlockPattern = /## State\s+\d+\s*\n\n```yaml\n([\s\S]*?)```/g;

  for (const match of markdown.matchAll(stateBlockPattern)) {
    const yaml = match[1];
    const codeRaw = readScalar(yaml, 'code');
    if (!codeRaw) continue;

    const code = Number.parseInt(codeRaw, 10);
    const label = readScalar(yaml, 'label');
    const title = readScalar(yaml, 'title');
    const summary = readScalar(yaml, 'summary');
    const implication = readScalar(yaml, 'implication');
    const severityRaw = readScalar(yaml, 'severity');
    const workflowRecommendationRaw = readScalar(yaml, 'workflow_recommendation');
    const workflowNote = readScalar(yaml, 'workflow_note');

    if (!label || !title || !summary || !implication || !severityRaw || !workflowRecommendationRaw || !workflowNote) {
      throw new Error(`Incomplete canonical recommendation metadata for cloud state ${code}.`);
    }

    if (!isSeverity(severityRaw)) {
      throw new Error(`Unknown canonical severity "${severityRaw}" for cloud state ${code}.`);
    }

    if (!isWorkflowRecommendation(workflowRecommendationRaw)) {
      throw new Error(`Unknown workflow recommendation "${workflowRecommendationRaw}" for cloud state ${code}.`);
    }

    const parserMatch = yaml.match(/^parser:\n([\s\S]*)$/m);
    if (!parserMatch) {
      configs.set(code, {
        code,
        label,
        title,
        summary,
        implication,
        severity: severityRaw,
        workflowRecommendation: workflowRecommendationRaw,
        workflowNote,
        checks: parseChecks(yaml),
        remediation: parseRemediation(yaml),
        parserConfig: null,
        parserProvenance: null,
      });
      continue;
    }

    const parserLines = parserMatch[1].split('\n');
    const anchorRaw = parserLines.find((line) => line.startsWith('  anchor_strategy:'))?.split(':').slice(1).join(':').trim();
    const timestampRaw = parserLines.find((line) => line.startsWith('  primary_timestamp_source:'))?.split(':').slice(1).join(':').trim();
    const formatValidationRaw = parserLines.find((line) => line.startsWith('    format_validation:'))?.split(':').slice(1).join(':').trim();
    const semanticsValidationRaw = parserLines.find((line) => line.startsWith('    semantics_validation:'))?.split(':').slice(1).join(':').trim();

    let parserProvenance: JmaParserProvenance | null = null;
    if (formatValidationRaw || semanticsValidationRaw) {
      if (!formatValidationRaw || !semanticsValidationRaw) {
        throw new Error(`Incomplete canonical provenance for cloud state ${code}.`);
      }
      if (!isValidationValue(formatValidationRaw)) {
        throw new Error(`Unknown canonical format validation value "${formatValidationRaw}" for cloud state ${code}.`);
      }
      if (!isValidationValue(semanticsValidationRaw)) {
        throw new Error(`Unknown canonical semantics validation value "${semanticsValidationRaw}" for cloud state ${code}.`);
      }
      parserProvenance = {
        formatValidation: formatValidationRaw,
        semanticsValidation: semanticsValidationRaw,
      };
    }

    if (!anchorRaw || !timestampRaw || anchorRaw === 'not_defined_yet' || timestampRaw === 'not_defined_yet') {
      configs.set(code, {
        code,
        label,
        title,
        summary,
        implication,
        severity: severityRaw,
        workflowRecommendation: workflowRecommendationRaw,
        workflowNote,
        checks: parseChecks(yaml),
        remediation: parseRemediation(yaml),
        parserConfig: null,
        parserProvenance,
      });
      continue;
    }

    if (!isAnchorStrategy(anchorRaw)) {
      throw new Error(`Unknown canonical anchor strategy "${anchorRaw}" for cloud state ${code}.`);
    }

    if (!isTimestampSource(timestampRaw)) {
      throw new Error(`Unknown canonical timestamp source "${timestampRaw}" for cloud state ${code}.`);
    }

    const evidenceFields: JmaParserEvidenceField[] = [];
    let currentField: Partial<JmaParserEvidenceField> | null = null;
    let inEvidenceFields = false;

    for (const rawLine of parserLines) {
      if (rawLine.startsWith('  evidence_fields:')) {
        inEvidenceFields = true;
        continue;
      }
      if (!inEvidenceFields) continue;
      if (!rawLine.startsWith('    ')) break;

      const keyMatch = rawLine.match(/^    - key:\s+(.+)$/);
      if (keyMatch) {
        if (currentField) {
          if (!currentField.key || !currentField.label || !currentField.description) {
            throw new Error(`Incomplete canonical evidence field for cloud state ${code}.`);
          }
          evidenceFields.push(currentField as JmaParserEvidenceField);
        }

        const key = keyMatch[1].trim();
        if (!isEvidenceKey(key)) {
          throw new Error(`Unknown canonical evidence key "${key}" for cloud state ${code}.`);
        }

        currentField = { key };
        continue;
      }

      if (!currentField) continue;

      const labelMatch = rawLine.match(/^      label:\s+(.+)$/);
      if (labelMatch) {
        currentField.label = labelMatch[1].trim();
        continue;
      }

      const descriptionMatch = rawLine.match(/^      description:\s+(.+)$/);
      if (descriptionMatch) {
        currentField.description = descriptionMatch[1].trim();
      }
    }

    if (currentField) {
      if (!currentField.key || !currentField.label || !currentField.description) {
        throw new Error(`Incomplete canonical evidence field for cloud state ${code}.`);
      }
      evidenceFields.push(currentField as JmaParserEvidenceField);
    }

    configs.set(code, {
      code,
      label,
      title,
      summary,
      implication,
      severity: severityRaw,
      workflowRecommendation: workflowRecommendationRaw,
      workflowNote,
      checks: parseChecks(yaml),
      remediation: parseRemediation(yaml),
      parserConfig: evidenceFields.length > 0
        ? {
            anchorStrategy: anchorRaw,
            primaryTimestampSource: timestampRaw,
            evidenceFields,
          }
        : null,
      parserProvenance,
    });
  }

  return configs;
}

const CANONICAL_PARSER_CONFIGS = parseStateParserConfigs(canonicalCloudStatusMarkdown);

export function getCanonicalJmaParserConfig(code: number | null): JmaParserConfig | null {
  if (code == null) return null;
  return CANONICAL_PARSER_CONFIGS.get(code)?.parserConfig ?? null;
}

export function getCanonicalJmaParserProvenance(code: number | null): JmaParserProvenance | null {
  if (code == null) return null;
  return CANONICAL_PARSER_CONFIGS.get(code)?.parserProvenance ?? null;
}

export function getCanonicalJmaStateDefinition(code: number | null): JmaCanonicalStateDefinition | null {
  if (code == null) return null;
  return CANONICAL_PARSER_CONFIGS.get(code) ?? null;
}
