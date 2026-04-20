import { describe, expect, it } from 'vitest';
import { ConfigDriftService } from '../src/services/config-drift.service';
import type { MistDeviceConfig } from '../src/services/mist-api.service';

describe('ConfigDriftService', () => {
  it('treats Mist bracket-array set commands as equivalent to switch-expanded lines', () => {
    const service = new ConfigDriftService();
    const mistConfig: MistDeviceConfig = {
      id: 'device-1',
      additional_config_cmds: [
        'set groups mist_ap interfaces <*> unit 0 family ethernet-switching vlan members [ guest home-trusted iot media home-untrusted device_mgmt ]',
      ],
    };

    const runningConfig = `
set groups mist_ap interfaces <*> unit 0 family ethernet-switching vlan members guest
set groups mist_ap interfaces <*> unit 0 family ethernet-switching vlan members home-trusted
set groups mist_ap interfaces <*> unit 0 family ethernet-switching vlan members iot
set groups mist_ap interfaces <*> unit 0 family ethernet-switching vlan members media
set groups mist_ap interfaces <*> unit 0 family ethernet-switching vlan members home-untrusted
set groups mist_ap interfaces <*> unit 0 family ethernet-switching vlan members device_mgmt
`;

    const result = service.compare(mistConfig, runningConfig);

    expect(result.mistOnlyLines).toEqual([]);
    expect(result.switchOnlyLines).toEqual([]);
    expect(result.totalMistLines).toBe(6);
    expect(result.totalSwitchLines).toBe(6);
    expect(result.matchedLines).toBe(6);
  });

  it('treats config_cmd cli group/apply-groups intent as equivalent to inherited switch config', () => {
    const service = new ConfigDriftService();
    const mistConfig: MistDeviceConfig = {
      id: 'device-1',
      cli: [
        'set interfaces interface-range mist_ap apply-groups mist_ap',
        'set interfaces interface-range mist_ap member ge-168/5/1',
        'set interfaces interface-range dot1x-mac-only apply-groups dot1x-mac-only',
        'set interfaces interface-range dot1x-mac-only member ge-0/0/4',
        'set groups mist_ap interfaces <*> unit 0 family ethernet-switching interface-mode trunk',
        'set groups mist_ap interfaces <*> unit 0 family ethernet-switching vlan members [ guest home-trusted iot media home-untrusted device_mgmt ]',
        'set groups mist_ap interfaces <*> unit 0 family ethernet-switching storm-control mist_ap',
        'set groups mist_ap interfaces <*> native-vlan-id 5',
        'set groups dot1x-mac-only interfaces <*> unit 0 family ethernet-switching interface-mode access',
        'set groups dot1x-mac-only interfaces <*> unit 0 family ethernet-switching vlan members [ default ]',
        'set groups dot1x-mac-only interfaces <*> unit 0 family ethernet-switching storm-control dot1x-mac-only',
        'set protocols rstp interface mist_ap edge',
        'set protocols rstp interface dot1x-mac-only edge',
        'set protocols dot1x authenticator interface dot1x-mac-only supplicant multiple',
        'set protocols dot1x authenticator interface dot1x-mac-only mac-radius restrict',
        'set groups top system name-server 1.1.1.1',
        'set groups top system name-server 8.8.8.8',
        'set groups top firewall family inet filter protect_re term allow_ssh from destination-port [ 22 ]',
        'set groups top firewall family inet filter protect_re term allow_ssh from protocol tcp',
        'set groups top firewall family inet filter protect_re term allow_ssh then accept',
        'set groups top forwarding-options storm-control-profiles mist_ap all bandwidth-percentage 40',
        'set apply-groups top',
        '# ignore comment lines from config_cmd',
        'delete interfaces ge-168/5/1 unit 0',
      ],
    };

    const runningConfig = `
set interfaces interface-range mist_ap member ge-168/5/1
set interfaces interface-range dot1x-mac-only member ge-0/0/4
set interfaces ge-168/5/1 native-vlan-id 5
set interfaces ge-168/5/1 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-168/5/1 unit 0 family ethernet-switching vlan members guest
set interfaces ge-168/5/1 unit 0 family ethernet-switching vlan members home-trusted
set interfaces ge-168/5/1 unit 0 family ethernet-switching vlan members iot
set interfaces ge-168/5/1 unit 0 family ethernet-switching vlan members media
set interfaces ge-168/5/1 unit 0 family ethernet-switching vlan members home-untrusted
set interfaces ge-168/5/1 unit 0 family ethernet-switching vlan members device_mgmt
set interfaces ge-168/5/1 unit 0 family ethernet-switching storm-control mist_ap
set interfaces ge-0/0/4 unit 0 family ethernet-switching interface-mode access
set interfaces ge-0/0/4 unit 0 family ethernet-switching vlan members default
set interfaces ge-0/0/4 unit 0 family ethernet-switching storm-control dot1x-mac-only
set protocols rstp interface ge-168/5/1 edge
set protocols rstp interface ge-0/0/4 edge
set protocols dot1x authenticator interface ge-0/0/4.0 supplicant multiple
set protocols dot1x authenticator interface ge-0/0/4.0 mac-radius restrict
set system name-server 1.1.1.1
set system name-server 8.8.8.8
set firewall family inet filter protect_re term allow_ssh from destination-port 22
set firewall family inet filter protect_re term allow_ssh from protocol tcp
set firewall family inet filter protect_re term allow_ssh then accept
set forwarding-options storm-control-profiles mist_ap all bandwidth-percentage 40
`;

    const result = service.compare(mistConfig, runningConfig);

    expect(result.mistOnlyLines).toEqual([]);
    expect(result.switchOnlyLines).toEqual([]);
    expect(result.matchedLines).toBe(result.totalMistLines);
    expect(result.totalMistLines).toBe(result.totalSwitchLines);
  });

  it('expands bracketed interface-range members and keeps only the effective scalar assignment', () => {
    const service = new ConfigDriftService();
    const mistConfig: MistDeviceConfig = {
      id: 'device-2',
      cli: [
        'set system host-name EX2300-C-12T-01',
        'set system time-zone UTC',
        'set system time-zone Australia/Melbourne',
        'set interfaces interface-range dot1x-mac-only member ge-0/0/[10-11]',
        'set protocols rstp interface dot1x-mac-only edge',
        'set protocols dot1x authenticator interface dot1x-mac-only supplicant multiple',
      ],
    };

    const runningConfig = `
set system host-name EX2300-C-12T-01
set system time-zone Australia/Melbourne
set protocols rstp interface ge-0/0/10 edge
set protocols rstp interface ge-0/0/11 edge
set protocols dot1x authenticator interface ge-0/0/10.0 supplicant multiple
set protocols dot1x authenticator interface ge-0/0/11.0 supplicant multiple
`;

    const result = service.compare(mistConfig, runningConfig);

    expect(result.mistOnlyLines).toEqual([]);
    expect(result.switchOnlyLines).toEqual([]);
    expect(result.totalMistLines).toBe(6);
    expect(result.totalSwitchLines).toBe(6);
    expect(result.matchedLines).toBe(6);
  });
});
