(function() {
    'use strict';

    var BuyWhereCurrency = {
        VERSION: '1.0.0',

        SUPPORTED_CURRENCIES: ['USD', 'SGD', 'VND', 'MYR', 'GBP'],

        RATES: {
            SGD: 1.35,
            USD: 1.0,
            VND: 24500,
            MYR: 4.7,
            GBP: 0.79
        },

        PREF_KEY: 'bw_currency_preference',

        detectMarket: function() {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            var marketMap = {
                'Asia/Singapore': 'SGD',
                'Asia/Kuala_Lumpur': 'MYR',
                'Asia/Bangkok': 'THB',
                'Asia/Jakarta': 'IDR',
                'Asia/Manila': 'PHP',
                'Asia/Ho_Chi_Minh': 'VND',
                'Europe/London': 'GBP'
            };
            return marketMap[tz] || 'SGD';
        },

        getPreferredCurrency: function() {
            var stored = localStorage.getItem(this.PREF_KEY);
            if (stored && this.SUPPORTED_CURRENCIES.indexOf(stored) !== -1) {
                return stored;
            }
            return this.detectMarket();
        },

        setPreferredCurrency: function(code) {
            if (this.SUPPORTED_CURRENCIES.indexOf(code) !== -1) {
                localStorage.setItem(this.PREF_KEY, code);
                this.dispatchChangeEvent(code);
            }
        },

        convert: function(amount, fromCurrency, toCurrency) {
            if (fromCurrency === toCurrency) {
                return { amount: amount, rate: 1 };
            }
            var inUSD = amount / this.RATES[fromCurrency];
            var result = inUSD * this.RATES[toCurrency];
            var rate = this.RATES[toCurrency] / this.RATES[fromCurrency];
            return { amount: result, rate: rate };
        },

        formatPrice: function(amount, currency) {
            var localeMap = {
                'USD': 'en-US',
                'SGD': 'en-SG',
                'VND': 'vi-VN',
                'MYR': 'en-MY',
                'GBP': 'en-GB'
            };
            var locale = localeMap[currency] || 'en-US';
            try {
                return new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: currency,
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(amount);
            } catch (e) {
                return currency + ' ' + amount.toFixed(2);
            }
        },

        formatConvertedPrice: function(amount, fromCurrency, toCurrency) {
            if (fromCurrency === toCurrency) {
                return this.formatPrice(amount, fromCurrency);
            }
            var converted = this.convert(amount, fromCurrency, toCurrency);
            var fromFormatted = this.formatPrice(amount, fromCurrency);
            var toFormatted = this.formatPrice(converted.amount, toCurrency);
            return fromFormatted + ' (~' + toFormatted + ')';
        },

        convertAndFormat: function(amount, fromCurrency, toCurrency) {
            if (fromCurrency === toCurrency) {
                return this.formatPrice(amount, fromCurrency);
            }
            var converted = this.convert(amount, fromCurrency, toCurrency);
            return this.formatPrice(converted.amount, toCurrency);
        },

        dispatchChangeEvent: function(newCurrency) {
            try {
                var event = new CustomEvent('bw-currency-changed', {
                    detail: { currency: newCurrency }
                });
                window.dispatchEvent(event);
            } catch (e) {}
        },

        init: function() {
            var self = this;
            var preferred = this.getPreferredCurrency();
            document.documentElement.setAttribute('data-bw-currency', preferred);

            var selector = document.querySelector('[data-bw-currency-selector]');
            if (selector) {
                var select = selector.querySelector('select') || selector;
                if (select.tagName === 'SELECT') {
                    select.value = preferred;
                    select.addEventListener('change', function(e) {
                        self.setPreferredCurrency(e.target.value);
                        self.updateAllPrices();
                    });
                }
            }

            this.updateAllPrices();
        },

        updateAllPrices: function() {
            var preferred = this.getPreferredCurrency();
            document.documentElement.setAttribute('data-bw-currency', preferred);

            var priceElements = document.querySelectorAll('[data-price][data-currency]');
            priceElements.forEach(function(el) {
                var amount = parseFloat(el.getAttribute('data-price'));
                var origCurrency = el.getAttribute('data-currency');

                if (origCurrency === preferred) {
                    el.textContent = BuyWhereCurrency.formatPrice(amount, origCurrency);
                    el.removeAttribute('data-bw-converted');
                } else {
                    var converted = BuyWhereCurrency.convert(amount, origCurrency, preferred);
                    el.textContent = BuyWhereCurrency.formatPrice(amount, origCurrency) + ' (~' + BuyWhereCurrency.formatPrice(converted.amount, preferred) + ')';
                    el.setAttribute('data-bw-converted', preferred);
                }
            });
        }
    };

    window.BuyWhereCurrency = BuyWhereCurrency;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            BuyWhereCurrency.init();
        });
    } else {
        BuyWhereCurrency.init();
    }
})();