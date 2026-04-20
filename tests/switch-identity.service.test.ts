import { describe, expect, it, vi } from 'vitest';
import { SwitchIdentityService } from '../src/services/switch-identity.service';

// ---- computeMistReachableHint (via identifyAndMatch) ----
// The hint is the key input to CloudStatusController.buildMistStatus. Test the
// cases where signals conflict so the cloud-status controller tests don't need to.

describe('SwitchIdentityService.computeMistReachableHint', () => {
  function makeService(stats: { status?: string; last_seen?: number } | null, inventoryConnected: boolean | null) {
    // Runner must return enough to populate identity.serial so findDeviceBySerial is called.
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show chassis hardware | match "^Chassis"') {
          return { command, output: 'Chassis                                ABC123            EX2300-C-12T', success: true };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({ output: '', matched: false })),
    };
    const mistApi = {
      isConfigured: true,
      findDeviceBySerial: vi.fn(async () => ({
        id: 'dev-1', mac: 'aa:bb:cc:dd:ee:ff', serial: 'ABC123',
        model: 'EX2300-C-12T', type: 'switch', site_id: 'site-1',
        connected: inventoryConnected,
      })),
      findDeviceByMac: vi.fn(async () => null),
      getDeviceConfig: vi.fn(async () => ({ id: 'dev-1', cli: [] })),
      getSite: vi.fn(async () => ({ id: 'site-1', name: 'Test' })),
      getDeviceStats: vi.fn(async () => stats),
    };
    return new SwitchIdentityService(runner as never, mistApi as never);
  }

  it('returns true when inventory says connected', async () => {
    const service = makeService(null, true);
    const result = await service.identifyAndMatch();
    expect(result.mistCloudReachableHint).toBe(true);
  });

  it('returns true when stats say connected', async () => {
    const service = makeService({ status: 'connected' }, null);
    const result = await service.identifyAndMatch();
    expect(result.mistCloudReachableHint).toBe(true);
  });

  it('returns true when only recent last_seen is available (no inventory or stats status)', async () => {
    const recentEpoch = Math.floor(Date.now() / 1000) - 60; // 1 min ago
    const service = makeService({ last_seen: recentEpoch }, null);
    const result = await service.identifyAndMatch();
    expect(result.mistCloudReachableHint).toBe(true);
  });

  it('returns false when inventory says not connected, even with a recent last_seen', async () => {
    const recentEpoch = Math.floor(Date.now() / 1000) - 60;
    const service = makeService({ status: 'disconnected', last_seen: recentEpoch }, false);
    const result = await service.identifyAndMatch();
    expect(result.mistCloudReachableHint).toBe(false);
    expect(result.mistRecentlySeen).toBe(true);
  });

  it('returns false when all signals are absent', async () => {
    const service = makeService(null, null);
    const result = await service.identifyAndMatch();
    expect(result.mistCloudReachableHint).toBe(false);
  });
});

function createRunnerStub() {
  return {
    execute: vi.fn(async (command: string) => {
      if (command === 'show chassis hardware | match "^Chassis"') {
        return {
          command,
          output: 'Chassis                                HW0217390439      EX2300-C-12T',
          success: true,
        };
      }

      if (command === 'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"') {
        return {
          command,
          output: `Hostname: EX2300-C-12T-01
Model: ex2300-c-12t
Junos: 23.4R2-S6.6
System serial number: HW0217390439`,
          success: true,
        };
      }

      if (command === 'show configuration system host-name | display set') {
        return {
          command,
          output: 'set system host-name EX2300-C-12T-01',
          success: true,
        };
      }

      if (command === 'show chassis hardware') {
        return {
          command,
          output: `Hardware inventory:
Item             Version  Part number  Serial number     Description
Chassis                                HW0217390439      EX2300-C-12T
Midplane         REV 07   750-057089   BA0217399999      EX2300-C`,
          success: true,
        };
      }

      if (command === 'show version') {
        return {
          command,
          output: `Hostname: EX2300-C-12T-01
Model: ex2300-c-12t
Junos: 23.4R2-S6.6
System serial number: HW0217390439`,
          success: true,
        };
      }

      if (command === 'show chassis mac-addresses') {
        return {
          command,
          output: 'Private base address     58:00:bb:b7:89:a2',
          success: true,
        };
      }

      if (command === 'show chassis mac-addresses | match "Base address"') {
        return {
          command,
          output: 'Private base address     58:00:bb:b7:89:a2',
          success: true,
        };
      }

      return {
        command,
        output: '',
        success: false,
        error: 'unexpected command',
      };
    }),
    sendAndWaitFor: vi.fn(async () => ({
      output: 'root@EX2300-C-12T-01>',
      matched: true,
    })),
  };
}

describe('SwitchIdentityService.identify', () => {
  it('parses hostname, serial, model, version, and mac from Junos outputs', async () => {
    const runner = createRunnerStub();
    const mistApi = {
      isConfigured: false,
    };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.hostname).toBe('EX2300-C-12T-01');
    expect(identity.serial).toBe('HW0217390439');
    expect(identity.model).toBe('EX2300-C-12T');
    expect(identity.junosVersion).toBe('23.4R2-S6.6');
    expect(identity.mac).toBe('58:00:bb:b7:89:a2');
  });

  it('prefers the filtered show version command before falling back to the full output', async () => {
    const runner = createRunnerStub();
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    await service.identify();

    expect(runner.execute).toHaveBeenCalledWith(
      'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"',
      15000,
      2000,
      { silent: undefined },
    );
    expect(runner.execute).toHaveBeenCalledWith(
      'show chassis hardware | match "^Chassis"',
      15000,
      2000,
      { silent: undefined },
    );
  });

  it('does not misparse the chassis header row as the serial or model', async () => {
    const runner = createRunnerStub();
    const mistApi = {
      isConfigured: false,
    };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.serial).not.toBe('Chassis');
    expect(identity.model).not.toBe('chassisw');
  });

  it('prefers the base address line for the switch MAC address', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show chassis hardware | match "^Chassis"') {
          return { command, output: '', success: true };
        }
        if (command === 'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"') {
          return { command, output: '', success: false };
        }
        if (command === 'show chassis hardware') {
          return { command, output: '', success: true };
        }
        if (command === 'show version') {
          return {
            command,
            output: `Hostname: EX2300-C-12T-01
Model: ex2300-c-12t
Junos: 23.4R2-S6.6
System serial number: HW0217390439`,
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses') {
          return {
            command,
            output: `FPC 0
  Base address       58:00:bb:b7:89:a2
  Some other address 58:00:bb:b7:89:a8`,
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses | match "Base address"') {
          return {
            command,
            output: 'Base address       58:00:bb:b7:89:a2',
            success: true,
          };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({ output: '', matched: false })),
    };
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.mac).toBe('58:00:bb:b7:89:a2');
  });

  it('does not misparse echoed filter tokens as model or serial fields', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show chassis hardware | match "^Chassis"') {
          return { command, output: '', success: true };
        }
        if (command === 'show configuration system host-name | display set') {
          return { command, output: 'system {\n  host-name EX2300-C-12T-01;\n}', success: true };
        }
        if (command === 'show chassis hardware') {
          return { command, output: '', success: true };
        }
        if (command === 'show version') {
          return {
            command,
            output: `show version | match "Hostname:|Model:|Junos:|System serial number:|Serial number:"
Hostname: EX2300-C-12T-01
Model: ex2300-c-12t
Junos: 23.4R2-S6.6
System serial number: HW0217390439`,
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        if (command === 'show chassis mac-addresses | match "Base address"') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({ output: '', matched: false })),
    };
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.hostname).toBe('EX2300-C-12T-01');
    expect(identity.serial).toBe('HW0217390439');
    expect(identity.model).toBe('EX2300-C-12T');
    expect(identity.junosVersion).toBe('23.4R2-S6.6');
  });

  it('falls back to show configuration system host-name when version lacks hostname', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show chassis hardware | match "^Chassis"') {
          return { command, output: '', success: true };
        }
        if (command === 'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"') {
          return { command, output: '', success: false };
        }
        if (command === 'show version') {
          return {
            command,
            output: `Model: ex2300-c-12t
Junos: 23.4R2-S6.6
System serial number: HW0217390439`,
            success: true,
          };
        }
        if (command === 'show chassis hardware') {
          return { command, output: '', success: true };
        }
        if (command === 'show configuration system host-name | display set') {
          return {
            command,
            output: 'set system host-name EX2300-C-12T-01',
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        if (command === 'show chassis mac-addresses | match "Base address"') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({ output: '', matched: false })),
    };
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.hostname).toBe('EX2300-C-12T-01');
    expect(identity.serial).toBe('HW0217390439');
    expect(identity.model).toBe('EX2300-C-12T');
  });

  it('rejects model-like serials and host-name placeholders from fallback output', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show chassis hardware | match "^Chassis"') {
          return {
            command,
            output: 'Chassis                                HW0217390439      EX2300-C-12T',
            success: true,
          };
        }
        if (command === 'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"') {
          return { command, output: '', success: false };
        }
        if (command === 'show version') {
          return {
            command,
            output: `Hostname: host-name
Model: ex2300-c-12t
Junos: 23.4R2-S6.6
System serial number: EX2300-C-9`,
            success: true,
          };
        }
        if (command === 'show chassis hardware') {
          return {
            command,
            output: `Hardware inventory:
Item             Version  Part number  Serial number     Description
Chassis                                HW0217390439      EX2300-C-12T`,
            success: true,
          };
        }
        if (command === 'show configuration system host-name | display set') {
          return {
            command,
            output: 'set system host-name EX2300-C-12T-01',
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        if (command === 'show chassis mac-addresses | match "Base address"') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({ output: '', matched: false })),
    };
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.hostname).toBe('EX2300-C-12T-01');
    expect(identity.serial).toBe('HW0217390439');
    expect(identity.model).toBe('EX2300-C-12T');
  });

  it('falls back to the CLI prompt for hostname when version output is noisy', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show chassis hardware | match "^Chassis"') {
          return { command, output: '', success: true };
        }
        if (command === 'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"') {
          return { command, output: '', success: false };
        }
        if (command === 'show version') {
          return {
            command,
            output: `JUNOS base package [20251017.142710_builder_junos_234_r2_s6]
JUNOS ex runtime [20251017.142710_builder_junos_234_r2_s6]
Model: ex2300-c-12t
Junos: 23.4R2-S6.6`,
            success: true,
          };
        }
        if (command === 'show chassis hardware') {
          return {
            command,
            output: `Hardware inventory:
Item             Version  Part number  Serial number     Description
Chassis                                HW0217390439      EX2300-C-12T`,
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        if (command === 'show configuration system host-name | display set') {
          return { command, output: '', success: true };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({
        output: '{master:0}\nroot@EX2300-C-12T-01>',
        matched: true,
      })),
    };
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.hostname).toBe('EX2300-C-12T-01');
    expect(identity.serial).toBe('HW0217390439');
    expect(identity.model).toBe('EX2300-C-12T');
  });

  it('does not guess a generic MAC when multiple MACs are present and no base address exists', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"') {
          return { command, output: '', success: false };
        }
        if (command === 'show version') {
          return {
            command,
            output: `Hostname: EX2300-C-12T-01
Model: ex2300-c-12t
Junos: 23.4R2-S6.6
System serial number: HW0217390439`,
            success: true,
          };
        }
        if (command === 'show chassis hardware') {
          return { command, output: '', success: true };
        }
        if (command === 'show chassis mac-addresses') {
          return {
            command,
            output: `FPC 0
  Some other address 58:00:bb:b7:89:a8
  Another address    58:00:bb:b7:89:a2`,
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses | match "Base address"') {
          return { command, output: '', success: true };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({ output: '', matched: false })),
    };
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.mac).toBeNull();
  });
});

describe('SwitchIdentityService.identifyAndMatch', () => {
  it('backfills missing hostname, serial, and model from a matched Mist device', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show chassis hardware | match "^Chassis"') {
          return {
            command,
            output: 'Chassis                                HW0217390439      EX2300-C-12T',
            success: true,
          };
        }
        if (command === 'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"') {
          return { command, output: '', success: false };
        }
        if (command === 'show version') {
          return {
            command,
            output: 'JUNOS Base OS boot [23.4R2-S6.6]',
            success: true,
          };
        }
        if (command === 'show chassis hardware') {
          return {
            command,
            output: 'Hardware inventory:\nChassis',
            success: true,
          };
        }
        if (command === 'show configuration system host-name | display set') {
          return { command, output: '', success: true };
        }
        if (command === 'show chassis mac-addresses') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({
        output: 'root@EX2300-C-12T-01>',
        matched: true,
      })),
    };

    const mistApi = {
      isConfigured: true,
      findDeviceBySerial: vi.fn(async () => null),
      findDeviceByMac: vi.fn(async () => ({
        id: 'dev-1',
        mac: '5800bbb789a2',
        serial: 'HW0217390439',
        model: 'EX2300-C-12T',
        type: 'switch',
        name: 'EX2300-C-12T-01',
        site_id: 'site-1',
        connected: true,
      })),
      getDeviceConfig: vi.fn(async () => ({ id: 'dev-1', cli: [] })),
      getSite: vi.fn(async () => ({ id: 'site-1', name: 'Home' })),
      getDeviceStats: vi.fn(async () => null),
    };

    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const result = await service.identifyAndMatch();

    expect(result.matchedBy).toBe('mac');
    expect(result.identity.hostname).toBe('EX2300-C-12T-01');
    expect(result.identity.serial).toBe('HW0217390439');
    expect(result.identity.model).toBe('EX2300-C-12T');
  });

  it('falls back to a Mist name match when serial and MAC matching fail', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
        if (command === 'show version | match "^(Hostname:|Model:|Junos:|System serial number:|Serial number:)"') {
          return { command, output: '', success: false };
        }
        if (command === 'show version') {
          return {
            command,
            output: `JUNOS base package [20251017.142710_builder_junos_234_r2_s6]
Model: ex2300-c-12t
Junos: 23.4R2-S6.6`,
            success: true,
          };
        }
        if (command === 'show chassis hardware') {
          return {
            command,
            output: `Hardware inventory:
Item             Version  Part number  Serial number     Description
Chassis                                HW0217390439      EX2300-C-12T`,
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses') {
          return {
            command,
            output: `FPC 0
  Some other address 58:00:bb:b7:89:a8
  Another address    58:00:bb:b7:89:a2`,
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses | match "Base address"') {
          return { command, output: '', success: true };
        }
        if (command === 'show configuration system host-name | display set') {
          return { command, output: '', success: true };
        }
        return { command, output: '', success: false };
      }),
      sendAndWaitFor: vi.fn(async () => ({
        output: '{master:0}\nroot@EX2300-C-12T-01>',
        matched: true,
      })),
    };

    const mistApi = {
      isConfigured: true,
      findDeviceBySerial: vi.fn(async () => null),
      findDeviceByMac: vi.fn(async () => null),
      findDeviceByName: vi.fn(async () => ({
        id: 'dev-1',
        mac: '5800bbb789a2',
        serial: 'HW0217390439',
        model: 'EX2300-C-12T',
        type: 'switch',
        name: 'EX2300-C-12T-01',
        site_id: 'site-1',
        connected: true,
      })),
      getDeviceConfig: vi.fn(async () => ({ id: 'dev-1', cli: [] })),
      getSite: vi.fn(async () => ({ id: 'site-1', name: 'Home' })),
      getDeviceStats: vi.fn(async () => null),
    };

    const service = new SwitchIdentityService(runner as never, mistApi as never);
    const result = await service.identifyAndMatch();

    expect(result.matchedBy).toBe('name');
    expect(result.identity.hostname).toBe('EX2300-C-12T-01');
    expect(result.identity.serial).toBe('HW0217390439');
    expect(result.identity.model).toBe('EX2300-C-12T');
  });
});
