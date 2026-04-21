import { TroubleshootService } from '../services/troubleshoot.service';
import { MistMatchResult, SwitchIdentityService } from '../services/switch-identity.service';
import {
  CloudStatusState,
  EMPTY_CLOUD_STATUS_STATE,
  EMPTY_JMA_CONNECTIVITY_STATUS,
  EMPTY_MIST_MONITOR_STATUS,
  MistMonitorStatus,
} from '../types/cloud-status.types';

export interface CloudStatusControllerCallbacks {
  onStatusUpdated(state: CloudStatusState): void;
  onRefreshStateChange?(inFlight: boolean): void;
}

export class CloudStatusController {
  private readonly switchIdentity: SwitchIdentityService;
  private readonly troubleshooter: TroubleshootService;
  private readonly callbacks: CloudStatusControllerCallbacks;
  private _state: CloudStatusState = { ...EMPTY_CLOUD_STATUS_STATE };
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private transientPauseCount = 0;
  private stagedPause = false;
  private inFlight = false;
  private pollingGetMatchResult: (() => MistMatchResult | null) | null = null;
  private pollingIsSerialConnected: (() => boolean) | null = null;

  constructor(
    switchIdentity: SwitchIdentityService,
    troubleshooter: TroubleshootService,
    callbacks: CloudStatusControllerCallbacks,
  ) {
    this.switchIdentity = switchIdentity;
    this.troubleshooter = troubleshooter;
    this.callbacks = callbacks;
  }

  get state(): CloudStatusState {
    return {
      ...this._state,
      mist: { ...this._state.mist },
      jma: { ...this._state.jma },
    };
  }

  async refresh(matchResult: MistMatchResult | null, serialConnected: boolean): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.callbacks.onRefreshStateChange?.(true);
    try {
      const mistPromise = this.buildMistStatus(matchResult);
      const jmaPromise = serialConnected
        ? this.troubleshooter.getJmaConnectivityState({ silent: true })
        : Promise.resolve({ ...EMPTY_JMA_CONNECTIVITY_STATUS, detail: 'Serial connection is not active.' });

      const [mist, jma] = await Promise.all([mistPromise, jmaPromise]);
      this._state = {
        matchResult,
        mist,
        jma,
        lastUpdatedUtcIso: new Date().toISOString(),
      };
      this.callbacks.onStatusUpdated(this.state);
    } finally {
      this.inFlight = false;
      this.callbacks.onRefreshStateChange?.(false);
    }
  }

  startPolling(
    getMatchResult: () => MistMatchResult | null,
    isSerialConnected: () => boolean,
    canRunBackgroundTask: () => boolean,
    intervalMs = 30000,
  ): void {
    this.stopPolling();
    this.pollingGetMatchResult = getMatchResult;
    this.pollingIsSerialConnected = isSerialConnected;
    this.intervalId = setInterval(() => {
      if ((this.transientPauseCount > 0 || this.stagedPause) || !this.pollingGetMatchResult || !this.pollingIsSerialConnected) return;
      if (!canRunBackgroundTask()) return;
      const matchResult = this.pollingGetMatchResult();
      if (!this.pollingIsSerialConnected()) return;
      void this.refresh(matchResult, this.pollingIsSerialConnected());
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  pausePolling(): void {
    this.transientPauseCount += 1;
  }

  resumePolling(): void {
    this.transientPauseCount = Math.max(0, this.transientPauseCount - 1);
  }

  /**
   * Pause background polling for the full duration of a staged config-sync
   * session. This is separate from the transient pause/resume wrapper used by
   * individual workflows so the switch is left quiet while a candidate config
   * is pending operator action.
   */
  setStagedPause(paused: boolean): void {
    this.stagedPause = paused;
  }

  reset(): void {
    this.stopPolling();
    this.transientPauseCount = 0;
    this.stagedPause = false;
    this._state = { ...EMPTY_CLOUD_STATUS_STATE };
    this.callbacks.onStatusUpdated(this.state);
  }

  private async buildMistStatus(matchResult: MistMatchResult | null): Promise<MistMonitorStatus> {
    const targetDevice = matchResult?.mistDevice ?? this.switchIdentity.getLaunchMistDevice();
    if (!targetDevice) {
      return {
        ...EMPTY_MIST_MONITOR_STATUS,
        detail: 'Identify and match the switch in Mist to enable Mist status monitoring.',
      };
    }

    const refreshed = await this.switchIdentity.refreshMistCloudStatus(targetDevice);
    if (refreshed.mistCloudReachableHint === true) {
      return {
        pillState: 'connected',
        label: 'Connected',
        detail: refreshed.mistCloudStatusLine || 'Mist reports the switch as cloud-reachable.',
        lastSeenUtcIso: refreshed.mistLastSeenUtcIso ?? null,
        lastConfigUtcIso: refreshed.mistLastConfigUtcIso ?? null,
      };
    }

    if (
      refreshed.mistInventoryConnected === false ||
      (refreshed.mistStatsStatus != null && /disconnect|offline|unreachable|down|lost/i.test(refreshed.mistStatsStatus))
    ) {
      return {
        pillState: 'disconnected',
        label: 'Disconnected',
        detail: refreshed.mistCloudStatusLine || 'Mist reports the switch as disconnected.',
        lastSeenUtcIso: refreshed.mistLastSeenUtcIso ?? null,
        lastConfigUtcIso: refreshed.mistLastConfigUtcIso ?? null,
      };
    }

    return {
      pillState: 'unknown',
      label: 'Unknown',
      detail: refreshed.mistCloudStatusLine || 'Mist state is not yet clear for this switch.',
      lastSeenUtcIso: refreshed.mistLastSeenUtcIso ?? null,
      lastConfigUtcIso: refreshed.mistLastConfigUtcIso ?? null,
    };
  }
}
