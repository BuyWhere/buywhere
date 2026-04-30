(function() {
    'use strict';

    var PriceHistoryChart = {
        VERSION: '1.0.0',
        DEFAULT_API_BASE: 'https://api.buywhere.io',

        create: function(canvasId, options) {
            var canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
            if (!canvas) {
                console.error('[PriceHistoryChart] Canvas not found:', canvasId);
                return null;
            }

            var config = Object.assign({
                apiBase: PriceHistoryChart.DEFAULT_API_BASE,
                productId: '',
                currency: 'USD',
                period: '90d',
                height: 300
            }, options || {});

            var chartInstance = null;

            var chart = {
                canvas: canvas,
                config: config,
                state: {
                    loading: false,
                    error: null,
                    history: null,
                    currentPrice: null
                }
            };

            var ctx = canvas.getContext('2d');

            function formatPrice(amount, currency) {
                var localeMap = {
                    'USD': 'en-US', 'SGD': 'en-SG', 'MYR': 'en-MY',
                    'IDR': 'id-ID', 'VND': 'vi-VN', 'PHP': 'en-PH'
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
            }

            function renderLoading(container) {
                var loadingEl = document.createElement('div');
                loadingEl.className = 'chart-loading';
                loadingEl.innerHTML = '<div class="spinner-small"></div>';
                return loadingEl;
            }

            function renderEmpty(container, message) {
                var emptyEl = document.createElement('div');
                emptyEl.className = 'chart-empty';
                emptyEl.innerHTML = '<p>' + (message || 'Not enough price history data available yet.') + '</p>';
                return emptyEl;
            }

            function renderChart(historyPoints, currency) {
                if (chartInstance) {
                    chartInstance.destroy();
                }

                var labels = historyPoints.map(function(p) {
                    return new Date(p.recorded_at).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
                });
                var data = historyPoints.map(function(p) { return p.price; });
                var currentPriceValue = chart.state.currentPrice || data[data.length - 1];

                chartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Price',
                            data: data,
                            borderColor: '#00D4C8',
                            backgroundColor: 'rgba(0, 212, 200, 0.1)',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 6,
                            pointHoverBackgroundColor: '#00D4C8',
                            fill: true,
                            tension: 0.1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            intersect: false,
                            mode: 'index'
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        return formatPrice(context.parsed.y, currency);
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                grid: { display: false },
                                ticks: { maxTicksLimit: 8 }
                            },
                            y: {
                                grid: { color: 'rgba(0,0,0,0.05)' },
                                ticks: {
                                    callback: function(value) {
                                        return formatPrice(value, currency);
                                    }
                                }
                            }
                        }
                    }
                });

                return chartInstance;
            }

            chart.fetch = function(period) {
                var p = period || config.period;
                chart.state.loading = true;
                chart.state.error = null;

                var container = canvas.parentElement;
                var existingLoading = container.querySelector('.chart-loading');
                var existingEmpty = container.querySelector('.chart-empty');
                if (existingLoading) existingLoading.remove();
                if (existingEmpty) existingEmpty.remove();

                container.appendChild(renderLoading(container));

                return fetch(config.apiBase + '/v1/products/' + encodeURIComponent(config.productId) + '/price-history?period=' + p, {
                    headers: { 'Content-Type': 'application/json' }
                })
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('Failed to fetch price history');
                    }
                    return response.json();
                })
                .then(function(data) {
                    chart.state.loading = false;
                    chart.state.history = data;

                    var loadingEl = container.querySelector('.chart-loading');
                    if (loadingEl) loadingEl.remove();

                    if (!data.history || data.history.length < 2) {
                        container.appendChild(renderEmpty(container, 'Not enough price history data for this period.'));
                        canvas.hidden = true;
                    } else {
                        canvas.hidden = false;
                        renderChart(data.history, config.currency);
                    }

                    return data;
                })
                .catch(function(err) {
                    chart.state.loading = false;
                    chart.state.error = err.message;

                    var loadingEl = container.querySelector('.chart-loading');
                    if (loadingEl) loadingEl.remove();
                    container.appendChild(renderEmpty(container, 'Failed to load price history.'));

                    return null;
                });
            };

            chart.setProduct = function(productId, currentPrice) {
                config.productId = productId;
                chart.state.currentPrice = currentPrice;
                return chart.fetch();
            };

            chart.destroy = function() {
                if (chartInstance) {
                    chartInstance.destroy();
                    chartInstance = null;
                }
            };

            return chart;
        }
    };

    window.PriceHistoryChart = PriceHistoryChart;
})();