class Autocomplete {
  constructor(options = {}) {
    this.inputEl = options.inputEl;
    this.containerEl = options.containerEl || null;
    this.apiUrl = options.apiUrl || '';
    this.debounceMs = options.debounceMs || 200;
    this.limit = options.limit || 5;
    this.country = options.country || 'US';
    this.onSelect = options.onSelect || null;
    this.onSearch = options.onSearch || null;

    this.query = '';
    this.suggestions = [];
    this.selectedIndex = -1;
    this.isOpen = false;
    this.debounceTimer = null;
    this.abortController = null;

    this.dropdown = null;

    if (!this.inputEl) {
      throw new Error('Autocomplete: inputEl is required');
    }

    this._bindEvents();
  }

  _bindEvents() {
    this.inputEl.addEventListener('input', this._handleInput.bind(this));
    this.inputEl.addEventListener('keydown', this._handleKeyDown.bind(this));
    this.inputEl.addEventListener('focus', () => this._maybeOpen());
    this.inputEl.addEventListener('blur', () => this._handleBlur());
    this.inputEl.addEventListener('touchstart', () => this._maybeOpen(), { passive: true });

    document.addEventListener('click', this._handleClickOutside.bind(this));
  }

  _handleClickOutside(e) {
    if (!this.isOpen) return;
    if (this.containerEl && this.containerEl.contains(e.target)) return;
    if (e.target === this.inputEl) return;
    this._close();
  }

  _handleBlur() {
    setTimeout(() => {
      if (!this.dropdown || !this.dropdown.matches(':focus-within')) {
        this._close();
      }
    }, 150);
  }

  _handleInput(e) {
    this.query = e.target.value;
    this.selectedIndex = -1;

    if (!this.query.trim()) {
      this._close();
      return;
    }

    this._cancelPendingRequest();
    this.debounceTimer = setTimeout(() => this._fetchSuggestions(), this.debounceMs);
  }

  _handleKeyDown(e) {
    if (!this.isOpen || this.suggestions.length === 0) {
      if (e.key === 'Enter' && this.query.trim()) {
        this._doSearch();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
        this._scrollToSelected();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = this.selectedIndex > 0 ? this.selectedIndex - 1 : -1;
        this._scrollToSelected();
        break;
      case 'Enter':
        e.preventDefault();
        if (this.selectedIndex >= 0 && this.selectedIndex < this.suggestions.length) {
          this._select(this.suggestions[this.selectedIndex]);
        } else if (this.query.trim()) {
          this._doSearch();
        }
        break;
      case 'Escape':
        e.preventDefault();
        this._close();
        this.inputEl.blur();
        break;
    }
  }

  _scrollToSelected() {
    if (!this.dropdown || this.selectedIndex < 0) return;
    const items = this.dropdown.querySelectorAll('[role="option"]');
    const selected = items[this.selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  _maybeOpen() {
    if (this.query.trim() && this.suggestions.length > 0) {
      this._open();
    }
  }

  _open() {
    this.isOpen = true;
    this._renderDropdown();
  }

  _close() {
    this.isOpen = false;
    this.selectedIndex = -1;
    if (this.dropdown && this.dropdown.parentNode) {
      this.dropdown.parentNode.removeChild(this.dropdown);
    }
    this.dropdown = null;
  }

  _cancelPendingRequest() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async _fetchSuggestions() {
    if (!this.query.trim()) return;

    this.abortController = new AbortController();

    try {
      const params = new URLSearchParams();
      params.set('q', this.query);
      params.set('country', this.country);
      params.set('limit', String(this.limit));

      const url = `${this.apiUrl}/v1/products?${params.toString()}`;
      const res = await fetch(url, {
        signal: this.abortController.signal,
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Autocomplete fetch failed: ${res.statusText}`);
      }

      const data = await res.json();
      this.suggestions = data.items || data.products || [];

      if (this.suggestions.length > 0) {
        this._open();
      } else {
        this._close();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.suggestions = [];
        this._close();
      }
    }
  }

  _select(product) {
    this.inputEl.value = product.name;
    this.query = product.name;
    this._close();
    if (this.onSelect) {
      this.onSelect(product);
    }
  }

  _doSearch() {
    this._close();
    if (this.onSearch) {
      this.onSearch(this.query.trim());
    }
  }

  _renderDropdown() {
    if (this.dropdown && this.dropdown.parentNode) {
      this.dropdown.parentNode.removeChild(this.dropdown);
    }

    this.dropdown = document.createElement('div');
    this.dropdown.className = 'autocomplete-dropdown';
    this.dropdown.setAttribute('role', 'listbox');
    this.dropdown.style.cssText = [
      'position: absolute',
      'z-index: 9999',
      'width: 100%',
      'margin-top: 4px',
      'background: #fff',
      'border-radius: 12px',
      'border: 1px solid #e5e7eb',
      'box-shadow: 0 10px 40px rgba(0,0,0,0.12)',
      'overflow: hidden',
      'font-family: system-ui, -apple-system, sans-serif',
    ].join('; ');

    const list = document.createElement('ul');
    list.style.cssText = 'list-style: none; margin: 0; padding: 8px 0;';

    this.suggestions.forEach((product, index) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
      item.dataset.index = String(index);

      item.style.cssText = [
        'display: flex',
        'align-items: center',
        'gap: 12px',
        'padding: 12px 16px',
        'cursor: pointer',
        'transition: background 0.15s',
        'background: ' + (index === this.selectedIndex ? '#eef2ff' : 'transparent'),
      ].join('; ');

      if (product.image_url) {
        const img = document.createElement('img');
        img.src = product.image_url;
        img.alt = '';
        img.style.cssText = 'width: 40px; height: 40px; object-fit: cover; border-radius: 8px; background: #f3f4f6;';
        item.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'width: 40px; height: 40px; border-radius: 8px; background: #f3f4f6; display: flex; align-items: center; justify-content: center;';
        placeholder.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
        item.appendChild(placeholder);
      }

      const info = document.createElement('div');
      info.style.cssText = 'flex: 1; min-width: 0;';

      const name = document.createElement('p');
      name.style.cssText = 'margin: 0; font-size: 14px; font-weight: 500; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
      name.textContent = product.name;
      info.appendChild(name);

      if (product.brand) {
        const brand = document.createElement('p');
        brand.style.cssText = 'margin: 0; font-size: 12px; color: #6b7280;';
        brand.textContent = product.brand;
        info.appendChild(brand);
      }

      item.appendChild(info);

      if (product.price !== null) {
        const price = document.createElement('span');
        price.style.cssText = 'font-size: 14px; font-weight: 600; color: #4f46e5;';
        price.textContent = `${product.currency || 'USD'} ${product.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        item.appendChild(price);
      }

      if (product.source) {
        const source = document.createElement('span');
        source.style.cssText = 'font-size: 11px; color: #9ca3af; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;';
        source.textContent = product.source;
        item.appendChild(source);
      }

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this._updateSelection();
      });

      item.addEventListener('mouseleave', () => {
        this.selectedIndex = -1;
        this._updateSelection();
      });

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._select(product);
      });

      list.appendChild(item);
    });

    this.dropdown.appendChild(list);

    const footer = document.createElement('div');
    footer.style.cssText = 'padding: 10px 16px; border-top: 1px solid #f3f4f6; background: #f9fafb;';

    const viewAll = document.createElement('button');
    viewAll.style.cssText = 'background: none; border: none; font-size: 13px; color: #4f46e5; font-weight: 500; cursor: pointer; padding: 0;';
    viewAll.textContent = `View all results for "${this.query}" →`;
    viewAll.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._doSearch();
    });
    footer.appendChild(viewAll);
    this.dropdown.appendChild(footer);

    const inputRect = this.inputEl.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(this.inputEl);
    const height = parseInt(computedStyle.height) || this.inputEl.offsetHeight;

    this.dropdown.style.position = 'fixed';
    this.dropdown.style.top = `${inputRect.top + inputRect.height + window.scrollY + 4}px`;
    this.dropdown.style.left = `${inputRect.left + window.scrollX}px`;
    this.dropdown.style.width = `${inputRect.width}px`;

    document.body.appendChild(this.dropdown);

    this._updateSelection();
  }

  _updateSelection() {
    if (!this.dropdown) return;
    const items = this.dropdown.querySelectorAll('[role="option"]');
    items.forEach((item, i) => {
      const isSelected = i === this.selectedIndex;
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      item.style.background = isSelected ? '#eef2ff' : 'transparent';
    });
  }

  destroy() {
    this._cancelPendingRequest();
    this.inputEl.removeEventListener('input', this._handleInput.bind(this));
    this.inputEl.removeEventListener('keydown', this._handleKeyDown.bind(this));
    this.inputEl.removeEventListener('focus', () => this._maybeOpen());
    this.inputEl.removeEventListener('blur', () => this._handleBlur());
    this.inputEl.removeEventListener('touchstart', () => this._maybeOpen());
    document.removeEventListener('click', this._handleClickOutside.bind(this));
    this._close();
  }

  static attachTo(selector, options = {}) {
    const input = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!input) {
      console.error(`Autocomplete: Element not found for selector: ${selector}`);
      return null;
    }
    return new Autocomplete({ ...options, inputEl: input });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Autocomplete;
}
