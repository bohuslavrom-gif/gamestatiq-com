import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://gamestatiq.com',
  i18n: {
    defaultLocale: 'cs',
    locales: ['cs', 'en', 'de'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap({
      i18n: {
        defaultLocale: 'cs',
        locales: { cs: 'cs-CZ', en: 'en-US', de: 'de-DE' },
      },
    }),
  ],
  build: {
    inlineStylesheets: 'auto',
  },
});
