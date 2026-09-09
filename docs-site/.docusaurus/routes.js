import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/docs/',
    component: ComponentCreator('/docs/', 'efb'),
    routes: [
      {
        path: '/docs/',
        component: ComponentCreator('/docs/', '488'),
        routes: [
          {
            path: '/docs/',
            component: ComponentCreator('/docs/', '00b'),
            routes: [
              {
                path: '/docs/api-reference/bulk',
                component: ComponentCreator('/docs/api-reference/bulk', '0a2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/api-reference/categories',
                component: ComponentCreator('/docs/api-reference/categories', 'a10'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/api-reference/compare',
                component: ComponentCreator('/docs/api-reference/compare', '2c0'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/api-reference/deals',
                component: ComponentCreator('/docs/api-reference/deals', '178'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/api-reference/get-product',
                component: ComponentCreator('/docs/api-reference/get-product', 'dbe'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/api-reference/price-history',
                component: ComponentCreator('/docs/api-reference/price-history', 'b3e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/api-reference/search',
                component: ComponentCreator('/docs/api-reference/search', 'a0f'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/api-reference/similar',
                component: ComponentCreator('/docs/api-reference/similar', 'ebe'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/api-reference/webhooks',
                component: ComponentCreator('/docs/api-reference/webhooks', '2ae'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/authentication',
                component: ComponentCreator('/docs/authentication', '373'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/errors',
                component: ComponentCreator('/docs/errors', '73b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/getting-started',
                component: ComponentCreator('/docs/getting-started', '3fb'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/mastra-integration',
                component: ComponentCreator('/docs/guides/mastra-integration', '640'),
                exact: true
              },
              {
                path: '/docs/guides/mcp-integration',
                component: ComponentCreator('/docs/guides/mcp-integration', 'a42'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/price-comparison',
                component: ComponentCreator('/docs/guides/price-comparison', '88d'),
                exact: true,
                sidebar: "docsSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '/',
    component: ComponentCreator('/', 'e5f'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
