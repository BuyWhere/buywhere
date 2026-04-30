(function() {
    'use strict';

    var API_BASE = 'https://api.buywhere.io';
    var TOKEN_KEY = 'bw_auth_token';
    var USER_KEY = 'bw_auth_user';

    var Auth = {
        token: null,
        user: null,

        init: function() {
            try {
                this.token = localStorage.getItem(TOKEN_KEY);
                var userStr = localStorage.getItem(USER_KEY);
                if (userStr) {
                    try {
                        this.user = JSON.parse(userStr);
                    } catch(e) {
                        this.user = null;
                    }
                }
            } catch(e) {
                this.token = null;
                this.user = null;
            }
            return this.isLoggedIn();
        },

        login: function(email, password) {
            var self = this;
            return fetch(API_BASE + '/api/v1/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, password: password })
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(data) {
                        var err = new Error(data.detail || 'Login failed');
                        err.status = response.status;
                        throw err;
                    });
                }
                return response.json();
            })
            .then(function(data) {
                self.token = data.access_token;
                self.user = { user_id: data.user_id, email: data.email };
                try {
                    localStorage.setItem(TOKEN_KEY, data.access_token);
                    localStorage.setItem(USER_KEY, JSON.stringify(self.user));
                } catch(e) {}
                return data;
            });
        },

        register: function(email, password) {
            var self = this;
            return fetch(API_BASE + '/api/v1/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, password: password })
            })
            .then(function(response) {
                if (!response.ok) {
                    return response.json().then(function(data) {
                        var err = new Error(data.detail || 'Registration failed');
                        err.status = response.status;
                        throw err;
                    });
                }
                return response.json();
            })
            .then(function(data) {
                return self.login(email, password);
            });
        },

        logout: function() {
            this.token = null;
            this.user = null;
            try {
                localStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem(USER_KEY);
            } catch(e) {}
            if (window.location.pathname !== '/') {
                window.location.href = '/';
            }
        },

        fetchUser: function() {
            var self = this;
            if (!this.token) return Promise.reject(new Error('No token'));
            return fetch(API_BASE + '/api/v1/auth/me', {
                headers: { 'Authorization': 'Bearer ' + this.token }
            })
            .then(function(response) {
                if (!response.ok) {
                    if (response.status === 401) {
                        self.logout();
                    }
                    throw new Error('Failed to fetch user');
                }
                return response.json();
            })
            .then(function(data) {
                self.user = data;
                try {
                    localStorage.setItem(USER_KEY, JSON.stringify(data));
                } catch(e) {}
                return data;
            });
        },

        getToken: function() {
            return this.token;
        },

        isLoggedIn: function() {
            return !!this.token;
        }
    };

    window.Auth = Auth;
})();
