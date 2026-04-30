(function() {
    'use strict';

    var API_BASE = 'https://api.buywhere.io';
    var STORAGE_KEY = 'bw_wishlist';

    var Wishlist = {
        add: function(productId, productName, productUrl, imageUrl, price) {
            if (!Auth.isLoggedIn()) {
                return this._addLocal(productId, productName, productUrl, imageUrl, price);
            }
            return fetch(API_BASE + '/api/v1/wishlist', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + Auth.getToken(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    product_id: productId,
                    product_name: productName,
                    product_url: productUrl,
                    image_url: imageUrl,
                    price: price
                })
            }).then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(data) {
                        throw new Error(data.detail || 'Failed to add to wishlist');
                    });
                }
                return response.json();
            });
        },

        list: function() {
            if (!Auth.isLoggedIn()) {
                return Promise.resolve(this._listLocal());
            }
            return fetch(API_BASE + '/api/v1/wishlist', {
                headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
            })
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to list wishlist');
                return response.json();
            })
            .then(function(data) {
                return data.items || data.wishlist || [];
            });
        },

        remove: function(itemId) {
            if (!Auth.isLoggedIn()) {
                return this._removeLocal(itemId);
            }
            return fetch(API_BASE + '/api/v1/wishlist/' + itemId, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
            }).then(function(response) {
                if (!response.ok && response.status !== 404) {
                    throw new Error('Failed to remove from wishlist');
                }
                return true;
            });
        },

        syncLocalToServer: function() {
            var self = this;
            var local = this._listLocal();
            if (local.length === 0) return Promise.resolve();
            return Promise.all(local.map(function(item) {
                return self.add(item.productId, item.productName, item.productUrl, item.imageUrl, item.price)
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

        _addLocal: function(productId, productName, productUrl, imageUrl, price) {
            var items = this._listLocal();
            var item = {
                id: 'local_' + Date.now(),
                productId: productId,
                productName: productName,
                productUrl: productUrl,
                imageUrl: imageUrl,
                price: price,
                addedAt: new Date().toISOString()
            };
            items.push(item);
            this._saveLocal(items);
            return Promise.resolve(item);
        },

        _listLocal: function() {
            try {
                var stored = localStorage.getItem(STORAGE_KEY);
                return stored ? JSON.parse(stored) : [];
            } catch(e) { return []; }
        },

        _removeLocal: function(itemId) {
            var items = this._listLocal().filter(function(i) { return i.id !== itemId; });
            this._saveLocal(items);
            return Promise.resolve(true);
        },

        _saveLocal: function(items) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
            } catch(e) {}
        },

        _clearLocal: function() {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch(e) {}
        }
    };

    window.Wishlist = Wishlist;
})();
