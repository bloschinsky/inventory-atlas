import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import Aura from '@primeuix/themes/aura';

/** @param {import('vue').App} app */
export function installUi(app) {
  app.use(PrimeVue, {
    theme: { preset: Aura, options: { darkModeSelector: false } },
    ripple: false,
  });
  app.use(ToastService);
}
