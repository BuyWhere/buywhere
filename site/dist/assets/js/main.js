(function() {
    'use strict';

    const LOCALE_STORAGE_KEY = 'bw_user_locale';
    const DEFAULT_COUNTRY = 'US';
    const DEFAULT_CURRENCY = 'USD';
    const SUPPORTED_COUNTRIES = ['US', 'SG', 'MY', 'ID', 'VN', 'PH'];
    const CURRENCY_MAP = {
        US: 'USD',
        SG: 'SGD',
        MY: 'MYR',
        ID: 'IDR',
        VN: 'VND',
        PH: 'PHP'
    };

    function detectUserCountry() {
        const cachedCountry = sessionStorage.getItem('bw_detected_country');
        if (cachedCountry && SUPPORTED_COUNTRIES.includes(cachedCountry)) {
            return Promise.resolve(cachedCountry);
        }
        
        return fetch('https://ipapi.co/json/')
            .then(response => response.json())
            .then(data => {
                const country = (data.country_code || '').toUpperCase();
                const detected = SUPPORTED_COUNTRIES.includes(country) ? country : null;
                if (detected) {
                    sessionStorage.setItem('bw_detected_country', detected);
                }
                return detected;
            })
            .catch(() => null);
    }

    function getStoredLocale() {
        try {
            return localStorage.getItem(LOCALE_STORAGE_KEY);
        } catch {
            return null;
        }
    }

    function setStoredLocale(country) {
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, country);
        } catch {
            // localStorage not available
        }
    }

    const LOCALE_MAP = {
        USD: 'en-US',
        SGD: 'en-SG',
        MYR: 'en-MY',
        IDR: 'id-ID',
        VND: 'vi-VN',
        PHP: 'en-PH'
    };

    function formatPrice(amount, currency) {
        try {
            const locale = LOCALE_MAP[currency] || LOCALE_MAP[DEFAULT_CURRENCY];
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: currency || DEFAULT_CURRENCY
            }).format(amount);
        } catch {
            return `${currency || DEFAULT_CURRENCY} ${amount}`;
        }
    }

    function applyLocale(country) {
        const currency = CURRENCY_MAP[country] || DEFAULT_CURRENCY;
        document.documentElement.setAttribute('data-locale', country);
        document.documentElement.setAttribute('data-currency', currency);
        
        document.querySelectorAll('[data-price]').forEach(el => {
            const amount = parseFloat(el.getAttribute('data-price'));
            if (!isNaN(amount)) {
                el.textContent = formatPrice(amount, currency);
            }
        });
    }

    async function initLocale() {
        const storedLocale = getStoredLocale();
        let country = storedLocale;
        
        if (!country) {
            const detected = await detectUserCountry();
            country = detected || DEFAULT_COUNTRY;
        }
        
        setStoredLocale(country);
        applyLocale(country);
        
        const localeSwitcher = document.querySelector('[data-locale-switcher]');
        if (localeSwitcher) {
            localeSwitcher.value = country;
            localeSwitcher.addEventListener('change', (e) => {
                const newCountry = e.target.value;
                setStoredLocale(newCountry);
                applyLocale(newCountry);
            });
        }
    }

    function initMobileNav() {
        const mobileToggle = document.querySelector('.nav-mobile-toggle');
        const mobileMenu = document.querySelector('.nav-mobile-menu');
        const mobileLinks = document.querySelector('.nav-mobile-links');
        const backdrop = document.querySelector('.nav-backdrop');

        if (mobileToggle && mobileMenu) {
            mobileToggle.addEventListener('click', function() {
                const isOpen = mobileMenu.classList.toggle('is-open');
                mobileToggle.setAttribute('aria-expanded', isOpen);
                document.documentElement.classList.toggle('nav-open', isOpen);
                if (backdrop) backdrop.classList.toggle('is-visible', isOpen);
            });

            if (backdrop) {
                backdrop.addEventListener('click', function() {
                    mobileMenu.classList.remove('is-open');
                    mobileToggle.setAttribute('aria-expanded', 'false');
                    document.documentElement.classList.remove('nav-open');
                    backdrop.classList.remove('is-visible');
                });
            }
        }

        const mobileDropdownTriggers = document.querySelectorAll('.nav-mobile-dropdown-trigger');
        mobileDropdownTriggers.forEach(trigger => {
            trigger.addEventListener('click', function() {
                const isOpen = this.getAttribute('aria-expanded') === 'true';
                this.setAttribute('aria-expanded', !isOpen);
                const submenu = this.nextElementSibling;
                if (submenu) submenu.classList.toggle('is-open');
            });
        });
    }

    function initDesktopNav() {
        const dropdownTriggers = document.querySelectorAll('.nav-dropdown-trigger');
        dropdownTriggers.forEach(trigger => {
            trigger.addEventListener('click', function(e) {
                const isOpen = this.getAttribute('aria-expanded') === 'true';
                this.setAttribute('aria-expanded', !isOpen);
                const menu = this.nextElementSibling;
                if (menu) menu.classList.toggle('is-open');
                e.stopPropagation();
            });

            trigger.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    this.setAttribute('aria-expanded', 'false');
                    const menu = this.nextElementSibling;
                    if (menu) menu.classList.remove('is-open');
                }
            });
        });

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.nav-dropdown')) {
                dropdownTriggers.forEach(trigger => {
                    trigger.setAttribute('aria-expanded', 'false');
                    const menu = trigger.nextElementSibling;
                    if (menu) menu.classList.remove('is-open');
                });
            }
        });
    }

    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                if (href === '#') return;
                
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });
    }

    function initCodeCopy() {
        document.querySelectorAll('pre code').forEach(block => {
            const wrapper = document.createElement('div');
            wrapper.className = 'code-wrapper';
            block.parentNode.insertBefore(wrapper, block);
            wrapper.appendChild(block);

            const button = document.createElement('button');
            button.className = 'copy-button';
            button.textContent = 'Copy';
            button.setAttribute('aria-label', 'Copy code to clipboard');
            wrapper.appendChild(button);

            button.addEventListener('click', async function() {
                const code = block.textContent;
                try {
                    await navigator.clipboard.writeText(code);
                    button.textContent = 'Copied!';
                    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
                } catch (err) {
                    button.textContent = 'Failed';
                    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
                }
            });
        });
    }

    function init() {
        initLocale();
        initDesktopNav();
        initMobileNav();
        initSmoothScroll();
        initCodeCopy();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
