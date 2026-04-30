(function () {
  'use strict';

  var DEFAULT_STORAGE_KEY = 'bw_saved_searches';
  var DEFAULT_API_BASE = '/api/v1/auth/me/saved-searches';
  var AUTH_TOKEN_STORAGE_KEY = 'bw_auth_token';
  var LEGACY_STORAGE_KEYS = ['bw_saved_searches', 'buywhere_saved_searches', 'saved_searches'];

  function isBrowser() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  function safeJsonParse(value, fallback) {
    if (!value) return fallback;

    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function normalizePayload(name, query, filters) {
    return {
      name: typeof name === 'string' ? name.trim() : '',
      query: typeof query === 'string' ? query : '',
      filters: filters && typeof filters === 'object' ? filters : {},
    };
  }

  function resolveAuthToken(optionValue) {
    if (typeof optionValue === 'function') {
      return optionValue() || null;
    }

    if (typeof optionValue === 'string' && optionValue.trim()) {
      return optionValue.trim();
    }

    if (!isBrowser()) {
      return null;
    }

    if (window.Auth && typeof window.Auth.token === 'string' && window.Auth.token) {
      return window.Auth.token;
    }

    var storedToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    return storedToken && storedToken.trim() ? storedToken.trim() : null;
  }

  function SavedSearches(options) {
    options = options || {};
    this.storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    this.apiBase = options.apiBase || DEFAULT_API_BASE;
    this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(window) : null);
    this.getAuthToken = function () {
      return resolveAuthToken(options.authToken);
    };
  }

  SavedSearches.prototype._readLocal = function () {
    if (!isBrowser()) {
      return [];
    }

    return LEGACY_STORAGE_KEYS.reduce(function (allSearches, key) {
      var stored = safeJsonParse(window.localStorage.getItem(key), []);
      if (!Array.isArray(stored)) {
        return allSearches;
      }

      return allSearches.concat(stored);
    }, []);
  };

  SavedSearches.prototype._writeLocal = function (searches) {
    if (!isBrowser()) {
      return;
    }

    LEGACY_STORAGE_KEYS.forEach(function (key) {
      if (key !== DEFAULT_STORAGE_KEY) {
        window.localStorage.removeItem(key);
      }
    });

    window.localStorage.setItem(this.storageKey, JSON.stringify(searches));
  };

  SavedSearches.prototype._request = async function (url, options) {
    var token = this.getAuthToken();
    if (!this.fetchImpl || !token) {
      return null;
    }

    var requestOptions = options || {};
    var headers = Object.assign({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    }, requestOptions.headers || {});

    var response = await this.fetchImpl(url, Object.assign({}, requestOptions, {
      headers: headers,
    }));

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      var error = new Error('Saved searches request failed with status ' + response.status);
      error.response = response;
      throw error;
    }

    return response.json();
  };

  SavedSearches.prototype.create = async function (name, query, filters) {
    var payload = normalizePayload(name, query, filters);

    if (!payload.name) {
      throw new Error('Saved search name is required.');
    }

    if (!this.getAuthToken()) {
      var localSearches = this._readLocal();
      var record = {
        id: 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        name: payload.name,
        query: payload.query,
        filters: payload.filters,
        createdAt: new Date().toISOString(),
      };

      localSearches.unshift(record);
      this._writeLocal(localSearches);
      return record;
    }

    return this._request(this.apiBase, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  };

  SavedSearches.prototype.list = async function () {
    if (!this.getAuthToken()) {
      return this._readLocal();
    }

    var data = await this._request(this.apiBase, { method: 'GET' });
    if (Array.isArray(data)) {
      return data;
    }

    if (data && Array.isArray(data.savedSearches)) {
      return data.savedSearches;
    }

    if (data && Array.isArray(data.saved_searches)) {
      return data.saved_searches;
    }

    if (data && Array.isArray(data.items)) {
      return data.items;
    }

    return [];
  };

  SavedSearches.prototype.delete = async function (savedSearchId) {
    if (!savedSearchId) {
      throw new Error('Saved search id is required.');
    }

    if (!this.getAuthToken()) {
      var localSearches = this._readLocal();
      var nextSearches = localSearches.filter(function (search) {
        return search.id !== savedSearchId;
      });

      this._writeLocal(nextSearches);
      return true;
    }

    await this._request(this.apiBase + '/' + encodeURIComponent(savedSearchId), {
      method: 'DELETE',
    });
    return true;
  };

  if (typeof window !== 'undefined') {
    window.SavedSearches = SavedSearches;
  }
})();
