export type ConsoleTaskKind = 'background' | 'user' | 'exclusive';

export type ConsoleTaskBlock = {
  kind: ConsoleTaskKind;
  label: string;
};

type ConsoleTaskOwner = {
  id: string;
  kind: ConsoleTaskKind;
  label: string;
  depth: number;
};

type ExternalBlockResolver = (ownerId?: string) => ConsoleTaskBlock | null;

export class ConsoleTaskGate {
  private owner: ConsoleTaskOwner | null = null;

  constructor(private readonly resolveExternalBlock?: ExternalBlockResolver) {}

  getBlockingTask(ownerId?: string): ConsoleTaskBlock | null {
    const externalBlock = this.resolveExternalBlock?.(ownerId) ?? null;
    if (externalBlock) return externalBlock;
    if (this.owner && this.owner.id !== ownerId) {
      return { kind: this.owner.kind, label: this.owner.label };
    }
    return null;
  }

  tryAcquire(ownerId: string, kind: ConsoleTaskKind, label: string): boolean {
    if (this.getBlockingTask(ownerId)) return false;
    if (this.owner && this.owner.id === ownerId) {
      this.owner.depth += 1;
      return true;
    }
    this.owner = { id: ownerId, kind, label, depth: 1 };
    return true;
  }

  release(ownerId: string): void {
    if (!this.owner || this.owner.id !== ownerId) return;
    this.owner.depth -= 1;
    if (this.owner.depth <= 0) {
      this.owner = null;
    }
  }

  getOwnerKind(): ConsoleTaskKind | null {
    return this.owner?.kind ?? null;
  }
}
