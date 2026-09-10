/**
 * Item-scoped rows of the search invalidation registry (blueprint section 9.4, ADR-017).
 *
 * The registry is the single place that states, for every Item mutation, which part of
 * `item_search` the source transaction must write synchronously and which follow-up work has to
 * leave the transaction as an outbox message. An Item mutation path registers the events this
 * planner returns; it never decides invalidation on its own.
 */

export const itemInvalidatorEvents = [
  'ItemCreated',
  'AttributeChanged',
  'ItemVisibilityChanged',
] as const;
export type ItemInvalidatorEvent = (typeof itemInvalidatorEvents)[number];

/** What the source transaction must refresh before it commits. */
export type SynchronousProjectionScope = 'item_search_row' | 'visibility_and_public_projections';

export interface ItemInvalidatorEntry {
  /** Synchronous obligation of the source transaction. */
  readonly synchronous: SynchronousProjectionScope;
  /**
   * Outbox topics the event always enqueues. Every Item-scoped row of the registry is fully
   * synchronous, so asynchronous rebuilds are enqueued by the Media and Schema paths instead.
   */
  readonly asynchronous: readonly string[];
}

export const itemInvalidatorRegistry: Readonly<Record<ItemInvalidatorEvent, ItemInvalidatorEntry>> =
  Object.freeze({
    ItemCreated: { synchronous: 'item_search_row', asynchronous: [] },
    AttributeChanged: { synchronous: 'item_search_row', asynchronous: [] },
    ItemVisibilityChanged: {
      synchronous: 'visibility_and_public_projections',
      asynchronous: [],
    },
  });

/** Aggregate-level differences an Item update can produce. */
export interface ItemChangeSignals {
  /** A typed attribute value was added, removed, or changed. */
  attributesChanged: boolean;
  /** A core column that feeds the projection row changed. */
  coreProjectionChanged: boolean;
  /** Effective Item visibility changed. */
  visibilityChanged: boolean;
}

export interface ItemInvalidationPlan {
  readonly events: readonly ItemInvalidatorEvent[];
  /** True when the whole projection row, not only visibility, has to be rewritten. */
  readonly rewritesProjectionRow: boolean;
  readonly asynchronousTopics: readonly string[];
}

/** Resolves the registry rows an Item update fires. Creation always fires `ItemCreated`. */
export function planItemInvalidation(signals: ItemChangeSignals): ItemInvalidationPlan {
  const events: ItemInvalidatorEvent[] = [];
  if (signals.attributesChanged || signals.coreProjectionChanged) events.push('AttributeChanged');
  if (signals.visibilityChanged) events.push('ItemVisibilityChanged');
  return plan(events);
}

export function creationInvalidation(): ItemInvalidationPlan {
  return plan(['ItemCreated']);
}

function plan(events: readonly ItemInvalidatorEvent[]): ItemInvalidationPlan {
  return {
    events,
    rewritesProjectionRow: events.some(
      (event) => itemInvalidatorRegistry[event].synchronous === 'item_search_row',
    ),
    asynchronousTopics: [
      ...new Set(events.flatMap((event) => itemInvalidatorRegistry[event].asynchronous)),
    ],
  };
}
