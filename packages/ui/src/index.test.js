import { describe, expect, it } from 'vitest';
import * as facade from './index.js';

describe('UI facade', () => {
  it('exports the complete approved semantic surface', () => {
    expect(Object.keys(facade).sort()).toEqual(
      [
        'AppBreadcrumb',
        'AppButton',
        'AppDataView',
        'AppDateField',
        'AppDialog',
        'AppDrawer',
        'AppField',
        'AppFileUpload',
        'AppFormSection',
        'AppInput',
        'AppMenu',
        'AppMoneyField',
        'AppMultiSelect',
        'AppPagination',
        'AppSelect',
        'AppTable',
        'AppTextarea',
        'AppToast',
        'installUi',
      ].sort(),
    );
  });
});
