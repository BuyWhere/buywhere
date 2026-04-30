(function() {
    'use strict';

    var UTM_STORAGE_KEY = 'bw_utm_params';
    var UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

    function parseUTMFromURL() {
        var params = {};
        var search = window.location.search.substring(1);
        if (!search) return params;
        var pairs = search.split('&');
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split('=');
            var key = decodeURIComponent(pair[0]);
            if (UTM_FIELDS.indexOf(key) !== -1) {
                params[key] = decodeURIComponent(pair[1] || '');
            }
        }
        return params;
    }

    function getUTM() {
        try {
            var stored = sessionStorage.getItem(UTM_STORAGE_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch (e) {
            return {};
        }
    }

    function setUTM(params) {
        try {
            sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(params));
        } catch (e) {
            // sessionStorage not available
        }
    }

    function clearUTM() {
        try {
            sessionStorage.removeItem(UTM_STORAGE_KEY);
        } catch (e) {
            // sessionStorage not available
        }
    }

    function hasUTM() {
        var utm = getUTM();
        return !!(utm.utm_source || utm.utm_medium || utm.utm_campaign);
    }

    function appendUTMToURL(url) {
        var utm = getUTM();
        if (!hasUTM()) return url;
        var separator = url.indexOf('?') !== -1 ? '&' : '?';
        var parts = [];
        for (var i = 0; i < UTM_FIELDS.length; i++) {
            var key = UTM_FIELDS[i];
            if (utm[key]) {
                parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(utm[key]));
            }
        }
        return url + separator + parts.join('&');
    }

    function initUTM() {
        var urlParams = parseUTMFromURL();
        if (urlParams.utm_source || urlParams.utm_medium || urlParams.utm_campaign) {
            setUTM(urlParams);
        }
        document.querySelectorAll('a[href="/register"], a[href="/login"]').forEach(function(link) {
            var originalHref = link.getAttribute('href');
            link.setAttribute('href', appendUTMToURL(originalHref));
        });
    }

    function applyUTMToForm(formEl) {
        var utm = getUTM();
        if (!formEl) return;
        UTM_FIELDS.forEach(function(key) {
            var existing = formEl.querySelector('input[name="' + key + '"]');
            if (existing) return;
            var input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = utm[key] || '';
            formEl.appendChild(input);
        });
    }

    window.BwUTM = {
        init: initUTM,
        get: getUTM,
        set: setUTM,
        clear: clearUTM,
        has: hasUTM,
        appendToURL: appendUTMToURL,
        applyToForm: applyUTMToForm
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUTM);
    } else {
        initUTM();
    }
})();