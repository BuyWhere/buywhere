(function() {
    'use strict';

    var Toast = {
        _container: null,
        _toasts: [],
        _maxToasts: 5,
        _defaultDuration: 4000,

        init: function() {
            if (this._container) return;
            this._container = document.createElement('div');
            this._container.id = 'bw-toast-container';
            this._container.setAttribute('role', 'region');
            this._container.setAttribute('aria-label', 'Notifications');
            this._container.style.cssText = [
                'position: fixed',
                'bottom: var(--bw-spacing-6, 1.5rem)',
                'right: var(--bw-spacing-6, 1.5rem)',
                'z-index: 9999',
                'display: flex',
                'flex-direction: column',
                'gap: var(--bw-spacing-3, 0.75rem)',
                'max-width: ' + (window.innerWidth < 480 ? 'calc(100vw - 2rem)' : '400px'),
                'width: ' + (window.innerWidth < 480 ? 'calc(100vw - 2rem)' : '400px'),
                'pointer-events: none'
            ].join(';');
            document.body.appendChild(this._container);
        },

        _createToast: function(message, variant, duration) {
            if (!this._container) this.init();

            var toast = document.createElement('div');
            toast.setAttribute('role', 'alert');
            toast.setAttribute('aria-live', 'polite');
            toast.style.cssText = [
                'display: flex',
                'align-items: ' + (variant === 'warning' ? 'flex-start' : 'center'),
                'gap: var(--bw-spacing-3, 0.75rem)',
                'padding: var(--bw-spacing-4, 1rem)',
                'background: var(--bw-color-bg-primary)',
                'border-radius: var(--bw-radius-lg, 0.5rem)',
                'box-shadow: var(--bw-shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1))',
                'border: 1px solid var(--bw-color-border)',
                'pointer-events: auto',
                'cursor: pointer',
                'animation: bw-toast-enter 0.3s ease-out',
                'position: relative',
                'overflow: hidden'
            ].join(';');

            var colors = this._getVariantColors(variant);
            toast.style.borderLeft = '4px solid ' + colors.border;

            var iconSvg = this._getVariantIcon(variant);
            toast.innerHTML = [
                '<div style="flex-shrink: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">' + iconSvg + '</div>',
                '<div style="flex: 1; min-width: 0;">',
                    '<p style="margin: 0; font-size: var(--bw-font-size-sm, 0.875rem); font-weight: 500; color: var(--bw-color-text-primary); line-height: 1.4;">' + this._escapeHtml(message) + '</p>',
                '</div>',
                '<button type="button" aria-label="Dismiss notification" style="flex-shrink: 0; background: none; border: none; padding: 0; cursor: pointer; color: var(--bw-color-text-muted); display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--bw-radius-sm); transition: background var(--bw-transition-fast);">&times;</button>',
                '<div class="bw-toast-progress" style="position: absolute; bottom: 0; left: 0; height: 3px; background: ' + colors.progress + '; animation: bw-toast-progress ' + duration + 'ms linear forwards; width: 100%; transform-origin: left;"></div>'
            ].join('');

            var closeBtn = toast.querySelector('button');
            var dismiss = function() {
                toast.style.animation = 'bw-toast-exit 0.2s ease-in forwards';
                setTimeout(function() {
                    toast.remove();
                    var idx = Toast._toasts.indexOf(toast);
                    if (idx > -1) Toast._toasts.splice(idx, 1);
                }, 200);
            };

            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                dismiss();
            });

            toast.addEventListener('click', dismiss);

            return toast;
        },

        _getVariantColors: function(variant) {
            var colors = {
                border: 'var(--bw-color-border)',
                progress: 'var(--bw-color-border)'
            };

            switch (variant) {
                case 'success':
                    colors.border = 'var(--bw-color-success, #10B981)';
                    colors.progress = 'var(--bw-color-success, #10B981)';
                    break;
                case 'error':
                    colors.border = 'var(--bw-color-error, #EF4444)';
                    colors.progress = 'var(--bw-color-error, #EF4444)';
                    break;
                case 'warning':
                    colors.border = 'var(--bw-color-warning, #F59E0B)';
                    colors.progress = 'var(--bw-color-warning, #F59E0B)';
                    break;
                case 'info':
                    colors.border = 'var(--bw-color-info, #3B82F6)';
                    colors.progress = 'var(--bw-color-info, #3B82F6)';
                    break;
            }

            return colors;
        },

        _getVariantIcon: function(variant) {
            switch (variant) {
                case 'success':
                    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                case 'error':
                    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
                case 'warning':
                    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
                case 'info':
                    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
                default:
                    return '';
            }
        },

        _escapeHtml: function(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        _addToast: function(toast) {
            while (this._toasts.length >= this._maxToasts) {
                var oldest = this._toasts.shift();
                if (oldest && oldest.parentNode) {
                    oldest.style.animation = 'bw-toast-exit 0.2s ease-in forwards';
                    setTimeout(function() { oldest.remove(); }, 200);
                }
            }

            this._toasts.push(toast);
            this._container.appendChild(toast);

            if (this._toasts.length === 1) {
                this._container.style.display = 'flex';
            }
        },

        success: function(message, duration) {
            var toast = this._createToast(message, 'success', duration || this._defaultDuration);
            this._addToast(toast);
            return toast;
        },

        error: function(message, duration) {
            var toast = this._createToast(message, 'error', duration || this._defaultDuration);
            this._addToast(toast);
            return toast;
        },

        warning: function(message, duration) {
            var toast = this._createToast(message, 'warning', duration || this._defaultDuration);
            this._addToast(toast);
            return toast;
        },

        info: function(message, duration) {
            var toast = this._createToast(message, 'info', duration || this._defaultDuration);
            this._addToast(toast);
            return toast;
        },

        show: function(message, variant, duration) {
            var toast = this._createToast(message, variant, duration || this._defaultDuration);
            this._addToast(toast);
            return toast;
        },

        dismissAll: function() {
            this._toasts.forEach(function(toast) {
                if (toast && toast.parentNode) {
                    toast.style.animation = 'bw-toast-exit 0.2s ease-in forwards';
                }
            });
            setTimeout(function() {
                Toast._toasts.forEach(function(toast) {
                    if (toast && toast.parentNode) toast.remove();
                });
                Toast._toasts = [];
            }, 200);
        }
    };

    var style = document.createElement('style');
    style.textContent = [
        '@keyframes bw-toast-enter {',
            'from { opacity: 0; transform: translateX(100%); }',
            'to { opacity: 1; transform: translateX(0); }',
        '}',
        '@keyframes bw-toast-exit {',
            'from { opacity: 1; transform: translateX(0); }',
            'to { opacity: 0; transform: translateX(100%); }',
        '}',
        '@keyframes bw-toast-progress {',
            'from { transform: scaleX(1); }',
            'to { transform: scaleX(0); }',
        '}',
        '@media (max-width: 480px) {',
            '#bw-toast-container {',
                'left: var(--bw-spacing-4, 1rem) !important;',
                'right: var(--bw-spacing-4, 1rem) !important;',
                'bottom: var(--bw-spacing-4, 1rem) !important;',
            '}',
            '@keyframes bw-toast-enter {',
                'from { opacity: 0; transform: translateY(100%); }',
                'to { opacity: 1; transform: translateY(0); }',
            '}',
            '@keyframes bw-toast-exit {',
                'from { opacity: 1; transform: translateY(0); }',
                'to { opacity: 0; transform: translateY(100%); }',
            '}',
        '}'
    ].join('');
    document.head.appendChild(style);

    window.Toast = Toast;
})();