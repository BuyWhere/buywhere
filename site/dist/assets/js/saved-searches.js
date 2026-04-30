(function() {
    'use strict';

    var API_BASE = 'https://api.buywhere.io';
    var STORAGE_KEY = 'bw_saved_searches';

    var SavedSearches = {
        create: function(name, query, filters) {
            if (!Auth.isLoggedIn()) {
                return this._createLocal(name, query, filters);
            }
            return fetch(API_BASE + '/api/v1/auth/me/saved-searches', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + Auth.getToken(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name,
                    query: query,
                    filters: filters || {}
                })
            }).then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(data) {
                        throw new Error(data.detail || 'Failed to save search');
                    });
                }
                return response.json();
            });
        },

        list: function() {
            if (!Auth.isLoggedIn()) {
                return Promise.resolve(this._listLocal());
            }
            return fetch(API_BASE + '/api/v1/auth/me/saved-searches', {
                headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
            })
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to list saved searches');
                return response.json();
            })
            .then(function(data) {
                return data.saved_searches || data.items || [];
            });
        },

        delete: function(savedSearchId) {
            if (!Auth.isLoggedIn()) {
                return this._deleteLocal(savedSearchId);
            }
            return fetch(API_BASE + '/api/v1/auth/me/saved-searches/' + savedSearchId, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
            }).then(function(response) {
                if (!response.ok && response.status !== 404) {
                    throw new Error('Failed to delete saved search');
                }
                return true;
            });
        },

        syncLocalToServer: function() {
            var self = this;
            var local = this._listLocal();
            if (local.length === 0) return Promise.resolve();
            return Promise.all(local.map(function(search) {
                return self.create(search.name, search.query, search.filters)
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

        _createLocal: function(name, query, filters) {
            var searches = this._listLocal();
            var search = {
                id: 'local_' + Date.now(),
                name: name,
                query: query,
                filters: filters || {},
                createdAt: new Date().toISOString()
            };
            searches.push(search);
            this._saveLocal(searches);
            return Promise.resolve(search);
        },

        _listLocal: function() {
            try {
                var stored = localStorage.getItem(STORAGE_KEY);
                return stored ? JSON.parse(stored) : [];
            } catch(e) { return []; }
        },

        _deleteLocal: function(id) {
            var searches = this._listLocal().filter(function(s) { return s.id !== id; });
            this._saveLocal(searches);
            return Promise.resolve(true);
        },

        _saveLocal: function(searches) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
            } catch(e) {}
        },

        _clearLocal: function() {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch(e) {}
        }
    };

    window.SavedSearches = SavedSearches;
})();
