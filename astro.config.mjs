import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://gamestatiq.com',
  output: 'server',
  adapter: vercel(),
  security: {
    checkOrigin: false,
  },
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
