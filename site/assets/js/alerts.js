(function() {
    'use strict';

    var API_BASE = 'https://api.buywhere.io';
    var STORAGE_KEY = 'bw_alerts';

    var Alerts = {
        create: function(productId, targetPrice, direction, callbackUrl) {
            if (!Auth.isLoggedIn()) {
                return this._createLocal(productId, targetPrice, direction, callbackUrl);
            }
            return fetch(API_BASE + '/api/auth/me/alerts', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + Auth.getToken(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    product_id: productId,
                    target_price: targetPrice,
                    direction: direction || 'below',
                    callback_url: callbackUrl || null
                })
            }).then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(data) {
                        throw new Error(data.detail || 'Failed to create alert');
                    });
                }
                return response.json();
            });
        },

        list: function() {
            if (!Auth.isLoggedIn()) {
                return Promise.resolve(this._listLocal());
            }
            return fetch(API_BASE + '/api/auth/me/alerts', {
                headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
            })
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to list alerts');
                return response.json();
            })
            .then(function(data) {
                return data.alerts || [];
            });
        },

        delete: function(alertId) {
            if (!Auth.isLoggedIn()) {
                return this._deleteLocal(alertId);
            }
            return fetch(API_BASE + '/api/auth/me/alerts/' + alertId, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
            }).then(function(response) {
                if (!response.ok && response.status !== 404) {
                    throw new Error('Failed to delete alert');
                }
                return true;
            });
        },

        syncLocalToServer: function() {
            var self = this;
            var local = this._listLocal();
            if (local.length === 0) return Promise.resolve();
            return Promise.all(local.map(function(alert) {
                return self.create(alert.productId, alert.targetPrice, alert.direction, alert.callbackUrl)
                    .then(function() { return true; })
                    .catch(function() { return false; });
            })).then(function(results) {
                var anySucceeded = results.some(function(r) { return r; });
                if (anySucceeded) {
                    self._clearLocal();
                }
                return anySucceeded;
            });
        },

        _createLocal: function(productId, targetPrice, direction, callbackUrl) {
            var alerts = this._listLocal();
            var alert = {
                id: 'local_' + Date.now(),
                productId: productId,
                targetPrice: targetPrice,
                direction: direction || 'below',
                callbackUrl: callbackUrl,
                createdAt: new Date().toISOString()
            };
            alerts.push(alert);
            this._saveLocal(alerts);
            return Promise.resolve(alert);
        },

        _listLocal: function() {
            try {
                var stored = localStorage.getItem(STORAGE_KEY);
                return stored ? JSON.parse(stored) : [];
            } catch(e) { return []; }
        },

        _deleteLocal: function(alertId) {
            var alerts = this._listLocal().filter(function(a) { return a.id !== alertId; });
            this._saveLocal(alerts);
            return Promise.resolve(true);
        },

        _saveLocal: function(alerts) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
            } catch(e) {}
        },

        _clearLocal: function() {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch(e) {}
        }
    };

    window.Alerts = Alerts;
})();
