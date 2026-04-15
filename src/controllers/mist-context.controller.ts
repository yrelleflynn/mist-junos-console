/**
 * mist-context.controller.ts — Mist API setup and site-loading workflow
 *
 * Extracted from src/main.ts so that credential management, site loading,
 * and Mist context state transitions can be reasoned about and tested
 * independently of the DOM.
 *
 * The controller owns:
 *   - the current MistContextState
 *   - calling MistApiService.configure() and listSites()
 *   - validation logic for the settings modal save action
 *
 * UI side-effects are delivered through the MistContextCallbacks object;
 * the controller has no direct DOM dependency.
 */

import { MistApiService, MistSite } from '../services/mist-api.service';
import { getCloudById, MistCloud } from '../config/mist-clouds.config';
import { MistContextState, EMPTY_MIST_CONTEXT } from '../types/mist-context.types';

/**
 * Callbacks the controller fires when Mist context state changes.
 * The caller (main.ts) implements these to update the DOM.
 */
export interface MistContextCallbacks {
  /** API status text changed — update the status element. */
  onStatusChange(text: string, type: 'success' | 'error' | 'info'): void;
  /** Site list loaded (may be empty). Caller should repopulate the dropdown. */
  onSitesLoaded(sites: MistSite[]): void;
  /** Loading state changed — disable/enable the Load Sites button. */
  onLoadingChange(loading: boolean): void;
}

export class MistContextController {
  private readonly api: MistApiService;
  private readonly callbacks: MistContextCallbacks;
  private _state: MistContextState = { ...EMPTY_MIST_CONTEXT };

  constructor(api: MistApiService, callbacks: MistContextCallbacks) {
    this.api = api;
    this.callbacks = callbacks;
  }

  /** Snapshot of the current Mist context state. */
  get state(): MistContextState {
    return { ...this._state };
  }

  /** True when the API is fully configured (token + host + orgId). */
  get isConfigured(): boolean {
    return this._state.isConfigured;
  }

  /** Currently selected site ID (empty string when none is selected). */
  get siteId(): string {
    return this._state.siteId;
  }

  /**
   * Validate and apply Mist API credentials from the settings modal.
   *
   * Calls MistApiService.configure() and updates internal state.
   * Returns true on success so the caller can close the modal.
   * Fires onStatusChange on both success and validation failure.
   */
  save(token: string, apiHost: string, orgId: string, cloud: MistCloud | null): boolean {
    if (!token || !orgId || !cloud) {
      this.callbacks.onStatusChange(
        'Fill Mist Cloud / Region, API token, and Org ID.',
        'error',
      );
      return false;
    }
    this.api.configure(token, apiHost, orgId);
    this._state = { ...this._state, cloud, orgId, isConfigured: true };
    this.callbacks.onStatusChange(
      'Mist API configuration saved. Use "Load Sites" to populate site list.',
      'success',
    );
    return true;
  }

  /**
   * Load the site list for the org identified by the supplied credentials.
   *
   * Also calls MistApiService.configure() so that subsequent API calls use
   * these credentials — matching the existing behaviour in main.ts.
   *
   * Fires callbacks for status text, loading state, and the loaded site list.
   */
  async loadSites(token: string, orgId: string, cloudId: string): Promise<void> {
    const cloud = getCloudById(cloudId);
    if (!token || !orgId || !cloud) {
      this.callbacks.onStatusChange(
        'Please fill in API token, Org ID, and select a cloud.',
        'error',
      );
      return;
    }

    this.api.configure(token, cloud.apiHost, orgId);
    this._state = { ...this._state, cloud, orgId, isConfigured: true };

    this.callbacks.onStatusChange('Loading sites…', 'info');
    this.callbacks.onLoadingChange(true);

    try {
      const sites = await this.api.listSites();
      this._state = { ...this._state, sites };
      this.callbacks.onSitesLoaded(sites);
      if (sites.length === 0) {
        this.callbacks.onStatusChange('No sites found in this org.', 'error');
      } else {
        this.callbacks.onStatusChange(`${sites.length} site(s) loaded.`, 'success');
      }
    } catch (err) {
      this.callbacks.onStatusChange(
        `Failed: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      this.callbacks.onLoadingChange(false);
    }
  }

  /** Record the selected site ID in state (called when the site dropdown changes). */
  selectSite(siteId: string): void {
    this._state = { ...this._state, siteId };
  }
}
