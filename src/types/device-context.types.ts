/**
 * device-context.types.ts — Shared identified-device context state shape
 *
 * Captures the result of a switch identify-and-match run. Features that need
 * to know about the currently-identified device (config drift, offline timeline,
 * adoption, status monitoring) read from this shape instead of depending on
 * the ad-hoc `lastMatchResult` variable in main.ts.
 */

import type { MistMatchResult, SwitchIdentity } from '../services/switch-identity.service';

export interface DeviceContextState {
  /** Full identify-and-match result, null before a successful identify run. */
  matchResult: MistMatchResult | null;
  /** True after at least one successful identify run. */
  isIdentified: boolean;
  /** True when the device was found in Mist inventory. */
  hasMistDevice: boolean;
  /** True when the matched Mist device has a site assignment. */
  hasSiteAssignment: boolean;
  /**
   * Local device identity gathered from the serial console (hostname, serial, MAC, model).
   * Set by runLocalIdentify() — available before Mist API is configured or matched.
   */
  localIdentity: SwitchIdentity | null;
}

export const EMPTY_DEVICE_CONTEXT: DeviceContextState = {
  matchResult: null,
  isIdentified: false,
  hasMistDevice: false,
  hasSiteAssignment: false,
  localIdentity: null,
};
