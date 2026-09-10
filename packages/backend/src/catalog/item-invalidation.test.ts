import { describe, expect, it } from 'vitest';
import {
  creationInvalidation,
  itemInvalidatorEvents,
  itemInvalidatorRegistry,
  planItemInvalidation,
} from './item-invalidation.js';

describe('CAT-04A Item search invalidation registry', () => {
  it('describes every Item-scoped registry row from blueprint section 9.4', () => {
    expect(Object.keys(itemInvalidatorRegistry).toSorted()).toEqual(
      [...itemInvalidatorEvents].toSorted(),
    );
    expect(itemInvalidatorRegistry.AttributeChanged).toEqual({
      synchronous: 'item_search_row',
      asynchronous: [],
    });
    expect(itemInvalidatorRegistry.ItemVisibilityChanged).toEqual({
      synchronous: 'visibility_and_public_projections',
      asynchronous: [],
    });
  });

  it('registers no event when an update changes nothing projection relevant', () => {
    expect(
      planItemInvalidation({
        attributesChanged: false,
        coreProjectionChanged: false,
        visibilityChanged: false,
      }),
    ).toEqual({ events: [], rewritesProjectionRow: false, asynchronousTopics: [] });
  });

  it('registers AttributeChanged for typed values and for projected core columns', () => {
    const attributes = planItemInvalidation({
      attributesChanged: true,
      coreProjectionChanged: false,
      visibilityChanged: false,
    });
    const core = planItemInvalidation({
      attributesChanged: false,
      coreProjectionChanged: true,
      visibilityChanged: false,
    });
    expect(attributes.events).toEqual(['AttributeChanged']);
    expect(core.events).toEqual(['AttributeChanged']);
    expect(core.rewritesProjectionRow).toBe(true);
  });

  it('registers both rows when visibility changes together with values', () => {
    const plan = planItemInvalidation({
      attributesChanged: true,
      coreProjectionChanged: false,
      visibilityChanged: true,
    });
    expect(plan.events).toEqual(['AttributeChanged', 'ItemVisibilityChanged']);
    expect(plan.rewritesProjectionRow).toBe(true);
    expect(plan.asynchronousTopics).toEqual([]);
  });

  it('registers a visibility-only change without rewriting the whole projection row', () => {
    const plan = planItemInvalidation({
      attributesChanged: false,
      coreProjectionChanged: false,
      visibilityChanged: true,
    });
    expect(plan.events).toEqual(['ItemVisibilityChanged']);
    expect(plan.rewritesProjectionRow).toBe(false);
  });

  it('registers ItemCreated for the creation path', () => {
    expect(creationInvalidation().events).toEqual(['ItemCreated']);
  });
});
