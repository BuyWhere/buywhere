(function() {
    'use strict';

    var BuyWhereWidget = {
        VERSION: '1.0.0',
        DEFAULT_API_BASE: 'https://api.buywhere.io',

        create: function(containerId, options) {
            var container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
            if (!container) {
                console.error('[BuyWhere Widget] Container not found:', containerId);
                return null;
            }

            var config = Object.assign({
                apiKey: '',
                apiBase: BuyWhereWidget.DEFAULT_API_BASE,
                query: '',
                asin: '',
                theme: 'light',
                layout: 'full',
                linkText: 'View on BuyWhere',
                currency: 'USD',
                locale: 'en-US',
                country: 'US',
                maxResults: 3
            }, options || {});

            var widget = {
                container: container,
                config: config,
                state: {
                    loading: false,
                    error: null,
                    results: []
                }
            };

            container.setAttribute('data-bw-widget', 'true');
            container.setAttribute('data-bw-theme', config.theme);
            container.setAttribute('data-bw-layout', config.layout);

            var style = document.createElement('style');
            style.textContent = BuyWhereWidget._getEmbeddedStyles();
            document.head.appendChild(style);

            widget._render = function() {
                var html = BuyWhereWidget._renderWidget(widget);
                container.innerHTML = html;
                widget._bindEvents();
            };

            widget._bindEvents = function() {
                var link = container.querySelector('[data-bw-action="view"]');
                if (link) {
                    link.addEventListener('click', function(e) {
                        e.preventDefault();
                        var searchQuery = encodeURIComponent(widget.config.query || widget.config.asin);
                        var url = 'https://buywhere.io/search?q=' + searchQuery + '&country=' + config.country;
                        window.open(url, '_blank');
                    });
                }
            };

            widget.search = function(query) {
                widget.config.query = query;
                return widget._fetch();
            };

            widget._fetch = function() {
                var query = widget.config.query;
                var asin = widget.config.asin;

                if (!query && !asin) {
                    widget.state.error = 'No query or ASIN provided';
                    widget._render();
                    return Promise.resolve([]);
                }

                widget.state.loading = true;
                widget.state.error = null;
                widget._render();

                var searchQuery = query || asin;
                var params = new URLSearchParams({ q: searchQuery, country: config.country, limit: String(config.maxResults) });

                var headers = { 'Content-Type': 'application/json' };
                if (widget.config.apiKey) {
                    headers['X-API-Key'] = widget.config.apiKey;
                }

                return fetch(widget.config.apiBase + '/v1/products/search?' + params, { headers: headers })
                    .then(function(response) {
                        if (!response.ok) {
                            throw new Error('API error: ' + response.status);
                        }
                        return response.json();
                    })
                    .then(function(data) {
                        widget.state.loading = false;
                        widget.state.results = data.products || [];
                        widget._render();
                        return widget.state.results;
                    })
                    .catch(function(err) {
                        widget.state.loading = false;
                        widget.state.error = err.message || 'Failed to fetch prices';
                        widget._render();
                        return [];
                    });
            };

            container.innerHTML = BuyWhereWidget._renderLoading(config);
            if (config.query || config.asin) {
                widget._fetch();
            } else {
                widget._render();
            }

            return widget;
        },

        _formatPrice: function(amount, currency) {
            var localeMap = {
                'USD': 'en-US',
                'SGD': 'en-SG',
                'MYR': 'en-MY',
                'IDR': 'id-ID',
                'VND': 'vi-VN',
                'PHP': 'en-PH'
            };
            var locale = localeMap[currency] || 'en-US';
            try {
                return new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: currency || 'USD'
                }).format(amount);
            } catch (e) {
                return currency + ' ' + amount;
            }
        },

        _renderLoading: function(config) {
            var isCompact = config.layout === 'compact';
            return '<div class="bw-widget ' + config.theme + ' ' + config.layout + '">' +
                '<div class="bw-widget__loading">' +
                '<span class="bw-widget__spinner"></span>' +
                '<span>Loading prices...</span>' +
                '</div>' +
                '</div>';
        },

        _renderWidget: function(widget) {
            var config = widget.config;
            var state = widget.state;
            var products = state.results;
            var cheapest = products.length > 0 ? products[0] : null;

            var html = '<div class="bw-widget ' + config.theme + ' ' + config.layout + '">';

            if (state.loading) {
                html += '<div class="bw-widget__loading">' +
                    '<span class="bw-widget__spinner"></span>' +
                    '<span>Loading prices...</span>' +
                    '</div>';
            } else if (state.error) {
                html += '<div class="bw-widget__error">' +
                    '<span class="bw-widget__error-icon">!</span>' +
                    '<span>' + state.error + '</span>' +
                    '</div>';
            } else if (products.length === 0) {
                html += '<div class="bw-widget__empty">' +
                    '<span>No prices found</span>' +
                    '</div>';
            } else {
                html += '<div class="bw-widget__header">';
                if (!config.query) {
                    html += '<span class="bw-widget__asin">ASIN: ' + config.asin + '</span>';
                }
                html += '</div>';

                if (cheapest) {
                    html += '<div class="bw-widget__cheapest">';
                    if (!isCompact) {
                        html += '<span class="bw-widget__label">Best Price</span>';
                    }
                    html += '<span class="bw-widget__price">' +
                        BuyWhereWidget._formatPrice(cheapest.price, cheapest.currency || config.currency) +
                        '</span>';
                    if (!isCompact) {
                        html += '<span class="bw-widget__retailer">' + (cheapest.platform || 'BuyWhere') + '</span>';
                    }
                    html += '</div>';
                }

                if (!isCompact && products.length > 1) {
                    html += '<div class="bw-widget__other">';
                    html += '<span class="bw-widget__other-label">Other prices:</span>';
                    html += '<ul class="bw-widget__list">';
                    for (var i = 1; i < Math.min(products.length, 4); i++) {
                        var p = products[i];
                        html += '<li>';
                        html += '<span class="bw-widget__list-price">' +
                            BuyWhereWidget._formatPrice(p.price, p.currency || config.currency) +
                            '</span>';
                        html += '<span class="bw-widget__list-retailer">' + (p.platform || '') + '</span>';
                        html += '</li>';
                    }
                    html += '</ul></div>';
                }

                html += '<div class="bw-widget__footer">';
                html += '<a href="#" class="bw-widget__link" data-bw-action="view">' + config.linkText + '</a>';
                html += '</div>';
            }

            html += '</div>';
            return html;
        },

        _getEmbeddedStyles: function() {
            return [
                '.bw-widget {',
                '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
                '  font-size: 14px;',
                '  line-height: 1.5;',
                '  max-width: 320px;',
                '  border-radius: 8px;',
                '  overflow: hidden;',
                '  box-shadow: 0 1px 3px rgba(0,0,0,0.1);',
                '}',
                '',
                '.bw-widget.light {',
                '  background: #ffffff;',
                '  color: #0f172a;',
                '  border: 1px solid #e2e8f0;',
                '}',
                '',
                '.bw-widget.dark {',
                '  background: #0f172a;',
                '  color: #f8fafc;',
                '  border: 1px solid #334155;',
                '}',
                '',
                '.bw-widget.compact {',
                '  max-width: 200px;',
                '}',
                '',
                '.bw-widget__loading,',
                '.bw-widget__error,',
                '.bw-widget__empty {',
                '  padding: 16px;',
                '  text-align: center;',
                '  display: flex;',
                '  align-items: center;',
                '  justify-content: center;',
                '  gap: 8px;',
                '}',
                '',
                '.bw-widget__spinner {',
                '  width: 16px;',
                '  height: 16px;',
                '  border: 2px solid currentColor;',
                '  border-top-color: transparent;',
                '  border-radius: 50%;',
                '  animation: bw-spin 0.8s linear infinite;',
                '  display: inline-block;',
                '}',
                '',
                '@keyframes bw-spin {',
                '  to { transform: rotate(360deg); }',
                '}',
                '',
                '.bw-widget__error {',
                '  color: #ef4444;',
                '}',
                '',
                '.bw-widget__error-icon {',
                '  width: 20px;',
                '  height: 20px;',
                '  background: #ef4444;',
                '  color: white;',
                '  border-radius: 50%;',
                '  display: inline-flex;',
                '  align-items: center;',
                '  justify-content: center;',
                '  font-weight: bold;',
                '  font-size: 12px;',
                '}',
                '',
                '.bw-widget__header {',
                '  padding: 12px 16px 0;',
                '}',
                '',
                '.bw-widget__asin {',
                '  font-size: 11px;',
                '  color: #64748b;',
                '  font-family: monospace;',
                '}',
                '',
                '.bw-widget.light .bw-widget__asin {',
                '  color: #64748b;',
                '}',
                '',
                '.bw-widget.dark .bw-widget__asin {',
                '  color: #94a3b8;',
                '}',
                '',
                '.bw-widget__cheapest {',
                '  padding: 16px;',
                '  display: flex;',
                '  flex-direction: column;',
                '  gap: 4px;',
                '}',
                '',
                '.bw-widget__label {',
                '  font-size: 11px;',
                '  text-transform: uppercase;',
                '  letter-spacing: 0.5px;',
                '  color: #10b981;',
                '  font-weight: 600;',
                '}',
                '',
                '.bw-widget__price {',
                '  font-size: 24px;',
                '  font-weight: 700;',
                '  color: #10b981;',
                '}',
                '',
                '.bw-widget__retailer {',
                '  font-size: 13px;',
                '  color: #64748b;',
                '}',
                '',
                '.bw-widget.light .bw-widget__retailer {',
                '  color: #64748b;',
                '}',
                '',
                '.bw-widget.dark .bw-widget__retailer {',
                '  color: #94a3b8;',
                '}',
                '',
                '.bw-widget__other {',
                '  padding: 0 16px 16px;',
                '  border-top: 1px solid;',
                '}',
                '',
                '.bw-widget.light .bw-widget__other {',
                '  border-color: #e2e8f0;',
                '}',
                '',
                '.bw-widget.dark .bw-widget__other {',
                '  border-color: #334155;',
                '}',
                '',
                '.bw-widget__other-label {',
                '  font-size: 11px;',
                '  text-transform: uppercase;',
                '  letter-spacing: 0.5px;',
                '  color: #64748b;',
                '  display: block;',
                '  margin-bottom: 8px;',
                '}',
                '',
                '.bw-widget__list {',
                '  list-style: none;',
                '  margin: 0;',
                '  padding: 0;',
                '}',
                '',
                '.bw-widget__list li {',
                '  display: flex;',
                '  justify-content: space-between;',
                '  padding: 4px 0;',
                '  font-size: 13px;',
                '}',
                '',
                '.bw-widget__list-price {',
                '  font-weight: 500;',
                '}',
                '',
                '.bw-widget__list-retailer {',
                '  color: #64748b;',
                '}',
                '',
                '.bw-widget.dark .bw-widget__list-retailer {',
                '  color: #94a3b8;',
                '}',
                '',
                '.bw-widget__footer {',
                '  padding: 12px 16px;',
                '  border-top: 1px solid;',
                '  text-align: center;',
                '}',
                '',
                '.bw-widget.light .bw-widget__footer {',
                '  border-color: #e2e8f0;',
                '  background: #f8fafc;',
                '}',
                '',
                '.bw-widget.dark .bw-widget__footer {',
                '  border-color: #334155;',
                '  background: #1e293b;',
                '}',
                '',
                '.bw-widget__link {',
                '  color: #0066ff;',
                '  text-decoration: none;',
                '  font-weight: 500;',
                '  font-size: 13px;',
                '}',
                '',
                '.bw-widget__link:hover {',
                '  text-decoration: underline;',
                '}'
            ].join('\n');
        }
    };

    window.BuyWhereWidget = BuyWhereWidget;

    function initWidgets() {
        document.querySelectorAll('[data-bw-widget-init]').forEach(function(el) {
            var query = el.getAttribute('data-bw-query') || '';
            var asin = el.getAttribute('data-bw-asin') || '';
            var theme = el.getAttribute('data-bw-theme') || 'light';
            var layout = el.getAttribute('data-bw-layout') || 'full';
            var apiKey = el.getAttribute('data-bw-apikey') || '';
            var linkText = el.getAttribute('data-bw-link-text') || 'View on BuyWhere';
            var country = el.getAttribute('data-bw-country') || 'US';

            BuyWhereWidget.create(el.id || el, {
                query: query,
                asin: asin,
                theme: theme,
                layout: layout,
                apiKey: apiKey,
                linkText: linkText,
                country: country
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidgets);
    } else {
        initWidgets();
    }
})();
