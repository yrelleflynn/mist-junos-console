import { describe, expect, it, vi } from 'vitest';

import { MIST_CLOUDS } from '../src/config/mist-clouds.config';
import {
  runRecommendedCatalogSuite,
  runTroubleshootWorkflow,
} from '../src/features/troubleshoot/catalog-runner';
import type { CheckResult } from '../src/services/troubleshoot.service';

describe('runRecommendedCatalogSuite', () => {
  const selectedCloud = MIST_CLOUDS[0];

  it('writes an error and exits early when run options cannot be resolved', async () => {
    const deps = {
      resolveEffectiveCloud: vi.fn().mockResolvedValue({ cloud: selectedCloud }),
      resolveRunOptions: vi.fn().mockReturnValue({ error: 'Select a Mist cloud region first.' }),
      withCloudStatusPollingPaused: vi.fn(async (fn) => await fn()),
      withConsoleTask: vi.fn(async (_ownerId, _kind, _label, fn) => await fn()),
      beginLatestAgentCheckRun: vi.fn(),
      refreshCatalogRunButtons: vi.fn(),
      activateResultsTab: vi.fn(),
      resetCatalogRows: vi.fn(),
      markCatalogRowsRunning: vi.fn(),
      describeEffectiveCloudResolution: vi.fn().mockReturnValue(null),
      runRecommendedChecks: vi.fn(),
      handleResults: vi.fn(),
      setCatalogRunning: vi.fn(),
      term: {
        writeSystem: vi.fn(),
        writeError: vi.fn(),
      },
    };

    await runRecommendedCatalogSuite({
      ownerId: 'catalog-single-check',
      ownerLabel: 'catalog check',
      checkIds: ['lldp'],
      rowIdsToReset: ['lldp'],
      rowIdsToMarkRunning: ['lldp'],
      startMessage: '— Running check: LLDP —',
      summaryTitle: 'LLDP summary',
      failureMessage: 'Check failed',
    }, deps);

    expect(deps.term.writeError).toHaveBeenCalledWith('Select a Mist cloud region first.');
    expect(deps.runRecommendedChecks).not.toHaveBeenCalled();
    expect(deps.refreshCatalogRunButtons).toHaveBeenCalledWith(false);
  });

  it('runs the recommended suite and handles results on success', async () => {
    const results: CheckResult[] = [
      { id: 'lldp', name: 'LLDP', status: 'pass', detail: 'ok' },
    ];
    const deps = {
      resolveEffectiveCloud: vi.fn().mockResolvedValue({ cloud: selectedCloud, host: 'api.mist.com' }),
      resolveRunOptions: vi.fn().mockReturnValue({
        options: {
          cloud: selectedCloud,
          uplinkPort: '',
          checkIds: ['lldp'],
          onProgress: 'progress',
        },
      }),
      withCloudStatusPollingPaused: vi.fn(async (fn) => await fn()),
      withConsoleTask: vi.fn(async (_ownerId, _kind, _label, fn) => await fn()),
      beginLatestAgentCheckRun: vi.fn(),
      refreshCatalogRunButtons: vi.fn(),
      activateResultsTab: vi.fn(),
      resetCatalogRows: vi.fn(),
      markCatalogRowsRunning: vi.fn(),
      describeEffectiveCloudResolution: vi.fn().mockReturnValue('Using inferred cloud'),
      runRecommendedChecks: vi.fn().mockResolvedValue(results),
      handleResults: vi.fn(),
      setCatalogRunning: vi.fn(),
      term: {
        writeSystem: vi.fn(),
        writeError: vi.fn(),
      },
    };

    await runRecommendedCatalogSuite({
      ownerId: 'catalog-single-check',
      ownerLabel: 'catalog check',
      checkIds: ['lldp'],
      rowIdsToReset: ['lldp'],
      rowIdsToMarkRunning: ['lldp'],
      startMessage: '— Running check: LLDP —',
      summaryTitle: 'LLDP summary',
      failureMessage: 'Check failed',
      completionMessage: '— Check complete —',
    }, deps);

    expect(deps.beginLatestAgentCheckRun).toHaveBeenCalled();
    expect(deps.activateResultsTab).toHaveBeenCalledWith('checks');
    expect(deps.resetCatalogRows).toHaveBeenCalledWith(['lldp']);
    expect(deps.markCatalogRowsRunning).toHaveBeenCalledWith(['lldp']);
    expect(deps.runRecommendedChecks).toHaveBeenCalled();
    expect(deps.handleResults).toHaveBeenCalledWith(results, 'LLDP summary');
    expect(deps.term.writeSystem).toHaveBeenCalledWith('— Running check: LLDP —');
    expect(deps.term.writeSystem).toHaveBeenCalledWith('  Using inferred cloud');
    expect(deps.term.writeSystem).toHaveBeenCalledWith('— Check complete —');
    expect(deps.setCatalogRunning).toHaveBeenCalledWith(true);
    expect(deps.setCatalogRunning).toHaveBeenCalledWith(false);
  });

  it('reports failures and still clears the running state', async () => {
    const deps = {
      resolveEffectiveCloud: vi.fn().mockResolvedValue({ cloud: selectedCloud }),
      resolveRunOptions: vi.fn().mockReturnValue({
        options: {
          cloud: selectedCloud,
          uplinkPort: '',
          checkIds: ['lldp'],
          onProgress: 'progress',
        },
      }),
      withCloudStatusPollingPaused: vi.fn(async (fn) => await fn()),
      withConsoleTask: vi.fn(async (_ownerId, _kind, _label, fn) => await fn()),
      beginLatestAgentCheckRun: vi.fn(),
      refreshCatalogRunButtons: vi.fn(),
      activateResultsTab: vi.fn(),
      resetCatalogRows: vi.fn(),
      markCatalogRowsRunning: vi.fn(),
      describeEffectiveCloudResolution: vi.fn().mockReturnValue(null),
      runRecommendedChecks: vi.fn().mockRejectedValue(new Error('boom')),
      handleResults: vi.fn(),
      setCatalogRunning: vi.fn(),
      term: {
        writeSystem: vi.fn(),
        writeError: vi.fn(),
      },
    };

    await runRecommendedCatalogSuite({
      ownerId: 'catalog-single-check',
      ownerLabel: 'catalog check',
      checkIds: ['lldp'],
      rowIdsToReset: ['lldp'],
      rowIdsToMarkRunning: ['lldp'],
      startMessage: '— Running check: LLDP —',
      summaryTitle: 'LLDP summary',
      failureMessage: 'Check failed',
    }, deps);

    expect(deps.term.writeError).toHaveBeenCalledWith('Check failed: boom');
    expect(deps.handleResults).not.toHaveBeenCalled();
    expect(deps.setCatalogRunning).toHaveBeenCalledWith(false);
  });
});

describe('runTroubleshootWorkflow', () => {
  const selectedCloud = MIST_CLOUDS[0];

  it('supports generic workflow execution with before/after hooks', async () => {
    const results: CheckResult[] = [
      { id: 'dns-config', name: 'DNS config', status: 'pass', detail: 'ok' },
    ];
    const beforeRun = vi.fn();
    const afterRun = vi.fn();
    const deps = {
      resolveEffectiveCloud: vi.fn().mockResolvedValue({ cloud: selectedCloud, host: 'api.mist.com' }),
      withCloudStatusPollingPaused: vi.fn(async (fn) => await fn()),
      withConsoleTask: vi.fn(async (_ownerId, _kind, _label, fn) => await fn()),
      beginLatestAgentCheckRun: vi.fn(),
      refreshCatalogRunButtons: vi.fn(),
      activateResultsTab: vi.fn(),
      describeEffectiveCloudResolution: vi.fn().mockReturnValue('Using inferred cloud'),
      setCatalogRunning: vi.fn(),
      term: {
        writeSystem: vi.fn(),
        writeError: vi.fn(),
      },
    };
    const execute = vi.fn().mockResolvedValue(results);
    const handleResults = vi.fn();

    await runTroubleshootWorkflow({
      ownerId: 'full-baseline',
      ownerLabel: 'full baseline troubleshooting',
      startMessage: '— Running full baseline troubleshooting workflow —',
      failureMessage: 'Full baseline failed',
      completionMessage: '— Full baseline complete —',
      beforeRun,
      afterRun,
      resolveExecution: (resolution) => ({
        options: {
          cloud: resolution.cloud,
          uplinkPort: '',
        },
      }),
      execute,
      handleResults,
    }, deps);

    expect(beforeRun).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith({
      cloud: selectedCloud,
      uplinkPort: '',
    });
    expect(handleResults).toHaveBeenCalledWith(results);
    expect(afterRun).toHaveBeenCalled();
    expect(deps.activateResultsTab).toHaveBeenCalledWith('checks');
    expect(deps.term.writeSystem).toHaveBeenCalledWith('— Full baseline complete —');
  });

  it('reports generic workflow resolution failures without executing', async () => {
    const deps = {
      resolveEffectiveCloud: vi.fn().mockResolvedValue({ cloud: null }),
      withCloudStatusPollingPaused: vi.fn(async (fn) => await fn()),
      withConsoleTask: vi.fn(async (_ownerId, _kind, _label, fn) => await fn()),
      beginLatestAgentCheckRun: vi.fn(),
      refreshCatalogRunButtons: vi.fn(),
      activateResultsTab: vi.fn(),
      describeEffectiveCloudResolution: vi.fn().mockReturnValue(null),
      setCatalogRunning: vi.fn(),
      term: {
        writeSystem: vi.fn(),
        writeError: vi.fn(),
      },
    };
    const execute = vi.fn();

    await runTroubleshootWorkflow({
      ownerId: 'full-baseline',
      ownerLabel: 'full baseline troubleshooting',
      startMessage: '— Running full baseline troubleshooting workflow —',
      failureMessage: 'Full baseline failed',
      resolveExecution: () => ({ error: 'Select a Mist cloud region before running the full baseline.' }),
      execute,
      handleResults: vi.fn(),
    }, deps);

    expect(deps.term.writeError).toHaveBeenCalledWith('Select a Mist cloud region before running the full baseline.');
    expect(execute).not.toHaveBeenCalled();
    expect(deps.refreshCatalogRunButtons).toHaveBeenCalledWith(false);
  });
});
