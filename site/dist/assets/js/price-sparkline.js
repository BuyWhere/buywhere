(function() {
    'use strict';

    var PriceSparkline = {
        VERSION: '1.0.0',

        create: function(container, priceHistory) {
            if (!container || !priceHistory || priceHistory.length < 2) {
                return null;
            }

            var points = priceHistory.slice(-30);
            var prices = points.map(function(p) { return p.price; });
            var min = Math.min.apply(null, prices);
            var max = Math.max.apply(null, prices);
            var range = max - min || 1;

            var width = 60;
            var height = 20;
            var padding = 2;

            var xStep = (width - padding * 2) / (points.length - 1);

            var pathData = points.map(function(p, i) {
                var x = padding + i * xStep;
                var y = padding + (1 - (p.price - min) / range) * (height - padding * 2);
                return x.toFixed(1) + ',' + y.toFixed(1);
            }).join(' ');

            var trend = prices[prices.length - 1] >= prices[0] ? 'up' : 'down';
            var color = trend === 'up' ? '#d97706' : '#16a34a';
            var lastPrice = prices[prices.length - 1];
            var firstPrice = prices[0];

            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', width);
            svg.setAttribute('height', height);
            svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            svg.setAttribute('class', 'price-sparkline');
            svg.setAttribute('aria-hidden', 'true');

            var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', pathData);
            polyline.setAttribute('fill', 'none');
            polyline.setAttribute('stroke', color);
            polyline.setAttribute('stroke-width', '1.5');
            polyline.setAttribute('stroke-linecap', 'round');
            polyline.setAttribute('stroke-linejoin', 'round');

            svg.appendChild(polyline);
            container.appendChild(svg);

            return {
                element: svg,
                trend: trend,
                lastPrice: lastPrice,
                firstPrice: firstPrice
            };
        },

        fetchAndRender: function(container, productId, options) {
            var apiBase = (options && options.apiBase) || 'https://api.buywhere.io';
            var period = (options && options.period) || '30d';

            return fetch(apiBase + '/v1/products/' + encodeURIComponent(productId) + '/price-history?period=' + period, {
                headers: { 'Content-Type': 'application/json' }
            })
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to fetch price history');
                return response.json();
            })
            .then(function(data) {
                if (data && data.history && data.history.length >= 2) {
                    return PriceSparkline.create(container, data.history);
                }
                return null;
            });
        }
    };

    window.PriceSparkline = PriceSparkline;
})();