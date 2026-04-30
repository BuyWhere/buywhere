(function() {
    'use strict';

    var API_BASE = 'https://api.buywhere.io';

    var Billing = {
        init: function() {
            if (!Auth.isLoggedIn()) {
                window.location.href = '/login';
                return;
            }
            this.loadBillingInfo();
            this.setupEventListeners();
        },

        loadBillingInfo: function() {
            var token = Auth.getToken();
            fetch(API_BASE + '/api/v1/billing/status', {
                headers: { 'Authorization': 'Bearer ' + token }
            })
            .then(function(response) {
                if (!response.ok) {
                    if (response.status === 401) {
                        Auth.logout();
                    }
                    throw new Error('Failed to load billing info');
                }
                return response.json();
            })
            .then(function(data) {
                Billing.renderBillingInfo(data);
            })
            .catch(function(err) {
                Billing.renderDemoData();
            });
        },

        renderBillingInfo: function(data) {
            var plan = data.tier || 'free';
            var planBadge = document.getElementById('planBadge');
            if (planBadge) {
                planBadge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
                planBadge.className = 'plan-badge ' + plan;
            }

            var renewalDate = document.getElementById('renewalDate');
            if (renewalDate && data.current_period_end) {
                renewalDate.textContent = new Date(data.current_period_end).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });
            }

            var currentUsage = data.requests_today || 0;
            var quotaLimit = data.requests_limit || 1000;
            var usagePercent = Math.min((currentUsage / quotaLimit) * 100, 100);

            var currentUsageEl = document.getElementById('currentUsage');
            if (currentUsageEl) currentUsageEl.textContent = currentUsage.toLocaleString();

            var quotaLimitEl = document.getElementById('quotaLimit');
            if (quotaLimitEl) quotaLimitEl.textContent = quotaLimit.toLocaleString();

            var usageBar = document.getElementById('usageBar');
            if (usageBar) {
                usageBar.style.width = usagePercent + '%';
                if (usagePercent >= 90) {
                    usageBar.classList.add('critical');
                } else if (usagePercent >= 75) {
                    usageBar.classList.add('warning');
                }
            }

            var resetDate = document.getElementById('resetDate');
            if (resetDate && data.current_period_end) {
                resetDate.textContent = new Date(data.current_period_end).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });
            }

            // Show payment failure alert if subscription is past_due or unpaid
            var paymentFailureAlert = document.getElementById('paymentFailureAlert');
            if (paymentFailureAlert) {
                if (data.subscription_status === 'past_due' || data.subscription_status === 'unpaid') {
                    paymentFailureAlert.style.display = 'block';
                } else {
                    paymentFailureAlert.style.display = 'none';
                }
            }

            var upgradeCard = document.getElementById('upgradeCard');
            if (upgradeCard) {
                if (plan === 'enterprise') {
                    upgradeCard.style.display = 'none';
                } else if (plan === 'pro' || plan === 'scale') {
                    var proUpgrade = document.getElementById('proUpgrade');
                    if (proUpgrade) proUpgrade.style.display = 'none';
                }
            }

            // Show manage billing button for paid plans
            var manageBillingBtn = document.getElementById('manageBillingBtn');
            if (manageBillingBtn) {
                if (plan === 'pro' || plan === 'scale') {
                    manageBillingBtn.style.display = 'block';
                } else {
                    manageBillingBtn.style.display = 'none';
                }
            }
        },

        renderDemoData: function() {
            var planBadge = document.getElementById('planBadge');
            if (planBadge) {
                planBadge.textContent = 'Free';
                planBadge.className = 'plan-badge free';
            }

            var renewalDate = document.getElementById('renewalDate');
            if (renewalDate) {
                var nextMonth = new Date();
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                nextMonth.setDate(1);
                renewalDate.textContent = nextMonth.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });
            }

            var currentUsageEl = document.getElementById('currentUsage');
            if (currentUsageEl) currentUsageEl.textContent = '247';

            var quotaLimitEl = document.getElementById('quotaLimit');
            if (quotaLimitEl) quotaLimitEl.textContent = '1,000';

            var usageBar = document.getElementById('usageBar');
            if (usageBar) usageBar.style.width = '24.7%';

            var resetDate = document.getElementById('resetDate');
            if (resetDate) {
                var nextMonth = new Date();
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                nextMonth.setDate(1);
                resetDate.textContent = nextMonth.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });
            }
        },

        setupEventListeners: function() {
            var upgradeProBtn = document.getElementById('upgradeProBtn');
            if (upgradeProBtn) {
                upgradeProBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    Billing.handleUpgrade('pro');
                });
            }

            var manageBillingBtn = document.getElementById('manageBillingBtn');
            if (manageBillingBtn) {
                manageBillingBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    Billing.handleManageBilling();
                });
            }
        },

        handleUpgrade: function(tier) {
            var token = Auth.getToken();
            fetch(API_BASE + '/api/v1/billing/subscribe', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tier: tier })
            })
            .then(function(response) {
                if (!response.ok) {
                    if (response.status === 401) {
                        Auth.logout();
                    }
                    throw new Error('Failed to create checkout session');
                }
                return response.json();
            })
            .then(function(data) {
                // Redirect to Stripe checkout
                if (data.checkout_url) {
                    window.location.href = data.checkout_url;
                }
            })
            .catch(function(err) {
                Toast.error('Error: ' + err.message);
            });
        },

        handleManageBilling: function() {
            var token = Auth.getToken();
            fetch(API_BASE + '/api/v1/billing/portal-session', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                }
            })
            .then(function(response) {
                if (!response.ok) {
                    if (response.status === 401) {
                        Auth.logout();
                    }
                    throw new Error('Failed to create portal session');
                }
                return response.json();
            })
            .then(function(data) {
                // Redirect to Stripe customer portal
                if (data.portal_url) {
                    window.location.href = data.portal_url;
                }
            })
            .catch(function(err) {
                Toast.error('Error: ' + err.message);
            });
        }
    };

    window.Billing = Billing;
})();