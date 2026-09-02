import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'BuyWhere API Docs',
  tagline: 'The product catalog API for AI agents',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.buywhere.ai',
  baseUrl: '/',

  organizationName: 'buywhere',
  projectName: 'buywhere-api',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'https://docs.buywhere.ai/img/buywhere-social-card.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'BuyWhere API',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://buywhere.ai/pricing',
          label: 'Pricing',
          position: 'left',
        },
        {
          href: 'https://github.com/buywhere/buywhere-api',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
        {
          href: 'https://buywhere.ai/api-keys',
          label: 'Get API Key',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'API Reference', to: '/docs/api-reference/search' },
            { label: 'Error Reference', to: '/docs/errors' },
          ],
        },
        {
          title: 'Guides',
          items: [
            { label: 'Price Comparison Tool', to: '/docs/guides/price-comparison' },
            { label: 'MCP Integration', to: '/docs/guides/mcp-integration' },
          ],
        },
        {
          title: 'Links',
          items: [
            { label: 'GitHub', href: 'https://github.com/buywhere/buywhere-api' },
            { label: 'buywhere.ai', href: 'https://buywhere.ai' },
            { label: 'Pricing', href: 'https://buywhere.ai/pricing' },
            { label: 'Status', href: 'https://status.buywhere.ai' },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} BuyWhere. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'python', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
