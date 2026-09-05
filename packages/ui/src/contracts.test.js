// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppField from './components/AppField.vue';
import { facadeContracts } from './contracts.js';

const requiredComponents = [
  'AppButton',
  'AppInput',
  'AppTextarea',
  'AppSelect',
  'AppMultiSelect',
  'AppDateField',
  'AppMoneyField',
  'AppField',
  'AppFormSection',
  'AppTable',
  'AppDataView',
  'AppDialog',
  'AppDrawer',
  'AppMenu',
  'AppToast',
  'AppBreadcrumb',
  'AppFileUpload',
  'AppPagination',
];

describe('facade contracts', () => {
  it('defines framework-neutral props, events, slots, states, and accessibility for every component', () => {
    expect(Object.keys(facadeContracts).sort()).toEqual(requiredComponents.sort());
    for (const contract of Object.values(facadeContracts)) {
      expect(contract.props).toBeInstanceOf(Array);
      expect(contract.events).toBeInstanceOf(Array);
      expect(contract.slots).toBeInstanceOf(Array);
      expect(contract.states).toContain('default');
      expect(contract.accessibility).toContain('zoom-200');
    }
    const allStates = new Set(Object.values(facadeContracts).flatMap(({ states }) => states));
    expect(allStates).toEqual(
      new Set(['default', 'loading', 'disabled', 'validation', 'empty', 'error', 'responsive']),
    );
  });

  it('connects a validation error to its stable field label', () => {
    const wrapper = mount(AppField, {
      props: { inputId: 'serial-number', label: 'Serial number', error: 'Required' },
      slots: { default: '<input id="serial-number" />' },
    });
    expect(wrapper.get('label').attributes('for')).toBe('serial-number');
    expect(wrapper.get('[role="alert"]').text()).toBe('Required');
  });
});
