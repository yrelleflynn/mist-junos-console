import type { MistCloud } from '../../config/mist-clouds.config';
import type { CheckResult } from '../../services/troubleshoot.service';

export interface CatalogRunOptions<TProgress> {
  cloud: MistCloud;
  uplinkPort: string;
  siteId?: string;
  deviceId?: string;
  checkIds: string[];
  onProgress: TProgress;
}

export interface RecommendedCatalogSuiteConfig {
  ownerId: string;
  ownerLabel: string;
  checkIds: string[];
  rowIdsToReset: string[];
  rowIdsToMarkRunning: string[];
  startMessage: string;
  startNotes?: string[];
  summaryTitle: string;
  failureMessage: string;
  completionMessage?: string;
}

export interface TroubleshootWorkflowConfig<TOptions, TCloudResolution> {
  ownerId: string;
  ownerLabel: string;
  startMessage: string;
  startNotes?: string[];
  failureMessage: string;
  completionMessage?: string;
  activatePane?: string;
  beforeRun?: () => void;
  afterRun?: () => void;
  resolveExecution: (
    resolution: TCloudResolution & { cloud: MistCloud | null },
  ) => { options: TOptions } | { error: string };
  execute: (options: TOptions) => Promise<CheckResult[]>;
  handleResults: (results: CheckResult[]) => void;
}

export interface TroubleshootWorkflowDeps<TCloudResolution> {
  resolveEffectiveCloud: () => Promise<TCloudResolution & { cloud: MistCloud | null }>;
  withCloudStatusPollingPaused: <T>(fn: () => Promise<T>) => Promise<T>;
  withConsoleTask: <T>(
    ownerId: string,
    kind: 'background' | 'user' | 'exclusive',
    label: string,
    fn: () => Promise<T>,
  ) => Promise<T | undefined>;
  beginLatestAgentCheckRun: () => void;
  refreshCatalogRunButtons: (forceDisabled: boolean) => void;
  activateResultsTab: (pane: string) => void;
  describeEffectiveCloudResolution: (resolution: TCloudResolution & { cloud: MistCloud | null }) => string | null;
  setCatalogRunning: (running: boolean) => void;
  term: {
    writeSystem: (message: string) => void;
    writeError: (message: string) => void;
  };
}

export interface RecommendedCatalogSuiteDeps<TProgress, TCloudResolution> {
  resolveEffectiveCloud: () => Promise<TCloudResolution & { cloud: MistCloud | null }>;
  resolveRunOptions: (
    checkIds: string[],
    cloudOverride?: MistCloud | null,
  ) => { options: CatalogRunOptions<TProgress> } | { error: string };
  withCloudStatusPollingPaused: <T>(fn: () => Promise<T>) => Promise<T>;
  withConsoleTask: <T>(
    ownerId: string,
    kind: 'background' | 'user' | 'exclusive',
    label: string,
    fn: () => Promise<T>,
  ) => Promise<T | undefined>;
  beginLatestAgentCheckRun: () => void;
  refreshCatalogRunButtons: (forceDisabled: boolean) => void;
  activateResultsTab: (pane: string) => void;
  resetCatalogRows: (catalogIds: string[]) => void;
  markCatalogRowsRunning: (catalogIds: string[]) => void;
  describeEffectiveCloudResolution: (resolution: TCloudResolution & { cloud: MistCloud | null }) => string | null;
  runRecommendedChecks: (options: CatalogRunOptions<TProgress>) => Promise<CheckResult[]>;
  handleResults: (results: CheckResult[], summaryTitle: string) => void;
  setCatalogRunning: (running: boolean) => void;
  term: {
    writeSystem: (message: string) => void;
    writeError: (message: string) => void;
  };
}

export async function runTroubleshootWorkflow<TOptions, TCloudResolution>(
  config: TroubleshootWorkflowConfig<TOptions, TCloudResolution>,
  deps: TroubleshootWorkflowDeps<TCloudResolution>,
): Promise<void> {
  await deps.withCloudStatusPollingPaused(async () => {
    await deps.withConsoleTask(config.ownerId, 'user', config.ownerLabel, async () => {
      const effectiveCloud = await deps.resolveEffectiveCloud();
      const resolved = config.resolveExecution(effectiveCloud);
      if ('error' in resolved) {
        deps.term.writeError(resolved.error);
        deps.refreshCatalogRunButtons(false);
        return;
      }

      deps.setCatalogRunning(true);
      deps.beginLatestAgentCheckRun();
      deps.refreshCatalogRunButtons(true);
      deps.activateResultsTab(config.activatePane ?? 'checks');
      config.beforeRun?.();

      deps.term.writeSystem(config.startMessage);
      for (const note of config.startNotes ?? []) {
        deps.term.writeSystem(`  ${note}`);
      }
      const cloudMessage = deps.describeEffectiveCloudResolution(effectiveCloud);
      if (cloudMessage) {
        deps.term.writeSystem(`  ${cloudMessage}`);
      }

      try {
        const results = await config.execute(resolved.options);
        config.handleResults(results);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.term.writeError(`${config.failureMessage}: ${message}`);
      } finally {
        deps.setCatalogRunning(false);
        config.afterRun?.();
        deps.refreshCatalogRunButtons(false);
        if (config.completionMessage) {
          deps.term.writeSystem(config.completionMessage);
        }
      }
    });
  });
}

export async function runRecommendedCatalogSuite<TProgress, TCloudResolution>(
  config: RecommendedCatalogSuiteConfig,
  deps: RecommendedCatalogSuiteDeps<TProgress, TCloudResolution>,
): Promise<void> {
  await runTroubleshootWorkflow({
    ownerId: config.ownerId,
    ownerLabel: config.ownerLabel,
    startMessage: config.startMessage,
    startNotes: config.startNotes,
    failureMessage: config.failureMessage,
    completionMessage: config.completionMessage,
    beforeRun: () => {
      deps.resetCatalogRows(config.rowIdsToReset);
      deps.markCatalogRowsRunning(config.rowIdsToMarkRunning);
    },
    resolveExecution: (resolution) => deps.resolveRunOptions(config.checkIds, resolution.cloud),
    execute: deps.runRecommendedChecks,
    handleResults: (results) => deps.handleResults(results, config.summaryTitle),
  }, deps);
}
