import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { installUi } from '@inventory-atlas/ui';
import '@inventory-atlas/ui/tokens.css';
import App from './app/App.vue';
import { createAppRouter } from './app/router.js';
import { applyDocumentLocale, i18n, initialLocale } from './shared/i18n/index.js';
import './app/app.css';

const app = createApp(App);
app.use(createPinia());
app.use(VueQueryPlugin, {
  queryClientConfig: { defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } },
});
app.use(createAppRouter());
app.use(i18n);
installUi(app);
applyDocumentLocale(initialLocale);
app.mount('#app');
