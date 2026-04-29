import type { CheckId, GroupId } from '../types/check.js';
import type { TroubleshootContext } from './troubleshoot-context.js';

export interface CheckDefinition {
  readonly id: CheckId;
  readonly groupId: GroupId;
  readonly label: string;
  readonly description: string;
  /**
   * Context fields this check requires to be populated before it runs.
   * The runner ensures resolvers for these fields have completed first.
   */
  readonly needs: readonly (keyof TroubleshootContext)[];
  /**
   * If any of these check IDs failed, this check is skipped automatically.
   * Gates are evaluated after their own checks resolve.
   */
  readonly gates?: readonly CheckId[];
  readonly timeoutMs?: number;
}

export interface ContextResolverDefinition {
  readonly id: string;
  readonly description: string;
  /** Context fields this resolver populates */
  readonly provides: readonly (keyof TroubleshootContext)[];
  /** Context fields that must be populated before this resolver runs */
  readonly needs?: readonly (keyof TroubleshootContext)[];
}
