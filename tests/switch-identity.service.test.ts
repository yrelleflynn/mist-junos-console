import { describe, expect, it, vi } from 'vitest';
import { SwitchIdentityService } from '../src/services/switch-identity.service';

function createRunnerStub() {
  return {
    execute: vi.fn(async (command: string) => {
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

      return {
        command,
        output: '',
        success: false,
        error: 'unexpected command',
      };
    }),
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
        return { command, output: '', success: false };
      }),
    };
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.mac).toBe('58:00:bb:b7:89:a2');
  });

  it('does not misparse echoed filter tokens as model or serial fields', async () => {
    const runner = {
      execute: vi.fn(async (command: string) => {
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
        return { command, output: '', success: false };
      }),
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
        if (command === 'show configuration system host-name') {
          return {
            command,
            output: `system {
  host-name EX2300-C-12T-01;
}`,
            success: true,
          };
        }
        if (command === 'show chassis mac-addresses') {
          return { command, output: 'Base address 58:00:bb:b7:89:a2', success: true };
        }
        return { command, output: '', success: false };
      }),
    };
    const mistApi = { isConfigured: false };
    const service = new SwitchIdentityService(runner as never, mistApi as never);

    const identity = await service.identify();

    expect(identity.hostname).toBe('EX2300-C-12T-01');
    expect(identity.serial).toBe('HW0217390439');
    expect(identity.model).toBe('EX2300-C-12T');
  });
});
