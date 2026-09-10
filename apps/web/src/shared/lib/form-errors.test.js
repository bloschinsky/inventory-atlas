import { describe, expect, it } from 'vitest';
import { fieldErrorsFromProblem } from './form-errors.js';

describe('fieldErrorsFromProblem', () => {
  it('maps the backend stable fieldErrors shape', () => {
    expect(
      fieldErrorsFromProblem({
        fieldErrors: [
          { field: 'displayName', messages: ['ITEM_DISPLAY_NAME_REQUIRED'] },
          { field: 'attributes.serial_number', messages: ['REQUIRED'] },
        ],
      }),
    ).toEqual({
      displayName: 'ITEM_DISPLAY_NAME_REQUIRED',
      'attributes.serial_number': 'REQUIRED',
    });
  });
});
