import { describe, expect, it } from 'vitest';

import { getJmaParserConfig, getJmaParserProvenance, getJmaRecommendation } from '../src/config/jma-recommendations';

describe('jma recommendation model', () => {
  it('keeps parser metadata alongside the 106 recommendation', () => {
    const recommendation = getJmaRecommendation(106);
    const parser = getJmaParserConfig(106);

    expect(recommendation?.title).toBe('DNS lookup failed');
    expect(recommendation?.workflowRecommendation).toBe('targeted');
    expect(recommendation?.checks.map((check) => check.id)).toEqual([
      'dns-config',
      'dns-server-reachability',
      'dns-resolution',
    ]);
    expect(recommendation?.parserProvenance?.formatValidation).toBe('validated_in_lab');
    expect(recommendation?.parserProvenance?.semanticsValidation).toBe('derived_from_lab_and_prototype');
    expect(parser?.anchorStrategy).toBe('mist_last_seen_then_event_sent');
    expect(parser?.primaryTimestampSource).toBe('disconnect_reason');
    expect(parser?.evidenceFields.map((field) => field.label)).toContain('Mist hostname lookup');
    expect(parser?.evidenceFields.map((field) => field.label)).toContain('Fallback resolver probe');
    expect(parser?.evidenceFields.map((field) => field.label)).toContain('Resolver library result');
  });

  it('reuses the same DNS-stage evidence shape for 106 and 113', () => {
    const dnsLookupFailed = getJmaParserConfig(106);
    const noDnsResponse = getJmaParserConfig(113);

    expect(dnsLookupFailed?.evidenceFields.map((field) => field.key)).toEqual(
      noDnsResponse?.evidenceFields.map((field) => field.key),
    );
  });

  it('reuses the same cloud-stage evidence shape for 108 and 109', () => {
    const cloudUnreachable = getJmaParserConfig(108);
    const cloudAuthFailure = getJmaParserConfig(109);

    expect(cloudUnreachable?.evidenceFields.map((field) => field.key)).toEqual(
      cloudAuthFailure?.evidenceFields.map((field) => field.key),
    );
  });

  it('loads cloud-stage parser labels from the canonical markdown model', () => {
    const parser = getJmaParserConfig(108);

    expect(parser?.evidenceFields.map((field) => field.label)).toContain('Cached cloud endpoint');
    expect(parser?.evidenceFields.map((field) => field.label)).toContain('Cloud websocket dial');
  });

  it('exposes provenance even when parser rules are not yet defined', () => {
    const recommendation = getJmaRecommendation(112);

    expect(recommendation?.parser).toBeUndefined();
    expect(recommendation?.parserProvenance?.formatValidation).toBe('validated_in_lab');
    expect(recommendation?.parserProvenance?.semanticsValidation).toBe('needs_more_field_validation');
    expect(getJmaParserProvenance(112)?.semanticsValidation).toBe('needs_more_field_validation');
  });
});
