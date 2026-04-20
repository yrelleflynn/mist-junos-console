/**
 * mist-context.types.ts — Shared Mist API context state shape
 *
 * Holds the currently-selected cloud region, credentials readiness,
 * org/site selection, and loaded site list. Controllers and future features
 * that need Mist context can read from this shape rather than holding ad-hoc
 * local variables.
 */

import type { MistSite, MistOrg } from '../services/mist-api.service';
import type { MistCloud } from '../config/mist-clouds.config';

export interface MistContextState {
  /** Selected cloud region, or null before one is chosen. */
  cloud: MistCloud | null;
  /** True when token, API host, and org ID are all set. */
  isConfigured: boolean;
  /** Mist org ID currently in use. */
  orgId: string;
  /** Selected site ID, or empty string when none is selected. */
  siteId: string;
  /** Site list loaded from the API, empty until loadSites succeeds. */
  sites: MistSite[];
  /** Org list loaded from GET /api/v1/self, empty until loadOrgs succeeds. */
  orgs: MistOrg[];
}

export const EMPTY_MIST_CONTEXT: MistContextState = {
  cloud: null,
  isConfigured: false,
  orgId: '',
  siteId: '',
  sites: [],
  orgs: [],
};
