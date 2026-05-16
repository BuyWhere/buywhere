import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'getting-started',
    'authentication',
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api-reference/search',
        'api-reference/get-product',
        'api-reference/categories',
        'api-reference/deals',
        'api-reference/compare',
        'api-reference/price-history',
        'api-reference/similar',
        'api-reference/bulk',
        'api-reference/webhooks',
      ],
    },
    'errors',
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/price-comparison',
        'guides/mcp-integration',
      ],
    },
  ],
};

export default sidebars;
