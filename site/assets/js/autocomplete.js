(function() {
    'use strict';

    const RETAILERS = [
        { id: 'amazon', name: 'Amazon', icon: 'amazon' },
        { id: 'walmart', name: 'Walmart', icon: 'walmart' },
        { id: 'target', name: 'Target', icon: 'target' },
        { id: 'bestbuy', name: 'Best Buy', icon: 'bestbuy' },
        { id: 'costco', name: 'Costco', icon: 'costco' },
        { id: 'homedepot', name: 'Home Depot', icon: 'homedepot' },
        { id: 'lowes', name: "Lowe's", icon: 'lowes' },
        { id: 'cvs', name: 'CVS', icon: 'cvs' }
    ];

    class Autocomplete {
        constructor(inputElement, options = {}) {
            this.input = inputElement;
            this.options = {
                apiUrl: '/v1/products',
                categoriesUrl: '/v1/categories',
                trendingSearchesUrl: '/api/v1/trending-searches',
                country: 'US',
                sources: ['products', 'retailers', 'categories'],
                limit: 5,
                sourceLimit: 3,
                debounceMs: 200,
                minLength: 2,
                recentSearchLimit: 5,
                recentSearchesKey: 'bw_recent_searches',
                onSearch: null,
                onError: null,
                onEmpty: null,
                onResultClick: null,
                ...options
            };
            
            this.results = [];
            this.flatResults = [];
            this.sectionMap = [];
            this.selectedIndex = -1;
            this.isOpen = false;
            this.isLoading = false;
            this.hasError = false;
            this.debounceTimer = null;
            this.container = null;
            this.listbox = null;
            this.trendingCache = null;
            this.trendingCacheTime = 0;
            this.trendingCacheTtl = 300000;
            
            this.init();
        }
        
        init() {
            this.createContainer();
            this.bindEvents();
        }
        
        createContainer() {
            this.container = document.createElement('div');
            this.container.className = 'bw-autocomplete';
            this.container.setAttribute('role', 'combobox');
            this.container.setAttribute('aria-expanded', 'false');
            this.container.setAttribute('aria-haspopup', 'listbox');
            this.container.setAttribute('aria-owns', 'bw-autocomplete-listbox');
            
            this.listbox = document.createElement('ul');
            this.listbox.id = 'bw-autocomplete-listbox';
            this.listbox.className = 'bw-autocomplete-listbox';
            this.listbox.setAttribute('role', 'listbox');
            this.listbox.hidden = true;
            
            this.input.parentNode.insertBefore(this.container, this.input);
            this.container.appendChild(this.input);
            this.container.appendChild(this.listbox);
        }
        
        bindEvents() {
            this.input.addEventListener('input', (e) => this.handleInput(e));
            this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
            this.input.addEventListener('focus', () => this.handleFocus());
            this.input.addEventListener('blur', () => this.handleBlur());
            
            this.listbox.addEventListener('touchstart', (e) => {
                const item = e.target.closest('[role="option"]');
                if (item) {
                    e.preventDefault();
                    this.selectItem(item);
                }
            }, { passive: false });
            
            document.addEventListener('click', (e) => {
                if (!this.container.contains(e.target)) {
                    this.close();
                }
            });
        }
        
        handleInput(e) {
            const value = e.target.value.trim();
            
            clearTimeout(this.debounceTimer);
            
            if (value.length < this.options.minLength) {
                if (value.length === 0) {
                    this.showRecentAndTrending();
                } else {
                    this.close();
                }
                return;
            }
            
            this.debounceTimer = setTimeout(() => {
                this.fetchResults(value);
            }, this.options.debounceMs);
        }
        
        showRecentAndTrending() {
            const recent = this.getRecentSearches();
            if (recent.length === 0 && !this.trendingCache) {
                this.fetchTrendingAndRender([]);
                return;
            }
            
            const combined = [...recent.map(q => ({ name: q, _type: 'recent', _source: 'recent' }))];
            this.flatResults = combined;
            this.sectionMap = [{ type: 'recent', label: 'Recent Searches', count: recent.length }];
            
            if (this.trendingCache && (Date.now() - this.trendingCacheTime) < this.trendingCacheTtl) {
                this.renderRecentAndTrending(recent, this.trendingCache);
            } else {
                this.fetchTrendingSearches().then(trending => {
                    this.trendingCache = trending;
                    this.trendingCacheTime = Date.now();
                    this.renderRecentAndTrending(recent, trending);
                });
            }
        }
        
        getRecentSearches() {
            try {
                const stored = localStorage.getItem(this.options.recentSearchesKey);
                return stored ? JSON.parse(stored) : [];
            } catch (e) {
                return [];
            }
        }
        
        saveSearch(query) {
            if (!query || query.trim().length < 2) return;
            const trimmed = query.trim();
            let recent = this.getRecentSearches();
            recent = recent.filter(q => q !== trimmed);
            recent.unshift(trimmed);
            recent = recent.slice(0, this.options.recentSearchLimit);
            try {
                localStorage.setItem(this.options.recentSearchesKey, JSON.stringify(recent));
            } catch (e) {}
        }
        
        async fetchTrendingSearches() {
            try {
                const response = await fetch(this.options.trendingSearchesUrl);
                if (!response.ok) return [];
                const data = await response.json();
                const items = data.items || data.queries || [];
                return items.map(i => typeof i === 'string' ? i : (i.query || i.term || i.name || '')).filter(Boolean).slice(0, 5);
            } catch (e) {
                return [];
            }
        }
        
        renderRecentAndTrending(recent, trending) {
            this.listbox.innerHTML = '';
            this.sectionMap = [];
            let globalIndex = 0;
            
            if (recent.length > 0) {
                const header = document.createElement('li');
                header.className = 'bw-autocomplete-section-header';
                header.textContent = 'Recent Searches';
                this.listbox.appendChild(header);
                
                recent.forEach(query => {
                    const li = document.createElement('li');
                    li.setAttribute('role', 'option');
                    li.setAttribute('id', `bw-autocomplete-option-${globalIndex}`);
                    li.setAttribute('aria-selected', 'false');
                    li.dataset.index = globalIndex;
                    li.dataset.query = query;
                    li.className = 'bw-autocomplete-item bw-autocomplete-item-recent';
                    li.innerHTML = `
                        <span class="bw-autocomplete-item-icon bw-autocomplete-item-icon-clock"></span>
                        <span class="bw-autocomplete-item-name">${this.escapeHtml(query)}</span>
                    `;
                    li.addEventListener('mouseenter', () => this.setActiveIndex(globalIndex));
                    li.addEventListener('mouseleave', () => this.setActiveIndex(-1));
                    this.listbox.appendChild(li);
                    globalIndex++;
                });
                this.sectionMap.push({ type: 'recent', label: 'Recent Searches', count: recent.length, startIndex: 0 });
            }
            
            if (trending.length > 0) {
                const header = document.createElement('li');
                header.className = 'bw-autocomplete-section-header';
                header.textContent = 'Trending';
                this.listbox.appendChild(header);
                
                trending.forEach(query => {
                    const li = document.createElement('li');
                    li.setAttribute('role', 'option');
                    li.setAttribute('id', `bw-autocomplete-option-${globalIndex}`);
                    li.setAttribute('aria-selected', 'false');
                    li.dataset.index = globalIndex;
                    li.dataset.query = query;
                    li.className = 'bw-autocomplete-item bw-autocomplete-item-trending';
                    li.innerHTML = `
                        <span class="bw-autocomplete-item-icon bw-autocomplete-item-icon-trending"></span>
                        <span class="bw-autocomplete-item-name">${this.escapeHtml(query)}</span>
                    `;
                    li.addEventListener('mouseenter', () => this.setActiveIndex(globalIndex));
                    li.addEventListener('mouseleave', () => this.setActiveIndex(-1));
                    this.listbox.appendChild(li);
                    globalIndex++;
                });
                this.sectionMap.push({ type: 'trending', label: 'Trending', count: trending.length, startIndex: recent.length });
            }
            
            this.flatResults = [
                ...recent.map(q => ({ name: q, _type: 'recent', _source: 'recent' })),
                ...trending.map(q => ({ name: q, _type: 'trending', _source: 'trending' }))
            ];
            this.selectedIndex = -1;
            this.open();
        }
        
        fetchTrendingAndRender(trending) {
            this.renderRecentAndTrending([], trending);
        }
        
        async fetchResults(query) {
            this.isLoading = true;
            this.hasError = false;
            this.renderLoading();
            
            if (this.options.onSearch) {
                this.options.onSearch({ query, type: 'start' });
            }
            
            try {
                const fetchPromises = [];
                const sources = this.options.sources || ['products'];
                
                if (sources.includes('products')) {
                    fetchPromises.push(
                        this.fetchProducts(query).then(data => ({ type: 'product', items: data }))
                    );
                }
                
                if (sources.includes('retailers')) {
                    fetchPromises.push(
                        Promise.resolve({ type: 'retailer', items: this.filterRetailers(query) })
                    );
                }
                
                if (sources.includes('categories')) {
                    fetchPromises.push(
                        this.fetchCategories(query).then(data => ({ type: 'category', items: data }))
                    );
                }
                
                const results = await Promise.all(fetchPromises);
                this.results = results.flatMap(r => r.items.map(item => ({ ...item, _type: r.type })));
                this.isLoading = false;
                
                if (this.results.length === 0) {
                    if (this.options.onEmpty) {
                        this.options.onEmpty({ query });
                    }
                    this.renderEmpty();
                } else {
                    this.renderResults();
                }
            } catch (error) {
                console.error('Autocomplete fetch error:', error);
                this.isLoading = false;
                this.hasError = true;
                this.results = [];
                
                if (this.options.onError) {
                    this.options.onError({ query, error: error.message });
                }
                this.renderError(error.message);
            }
        }
        
        async fetchProducts(query) {
            const url = `${this.options.apiUrl}?q=${encodeURIComponent(query)}&country=${this.options.country}&limit=${this.options.sourceLimit}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
            const data = await response.json();
            const products = data.data || data.products || data.items || [];
            return products.map(p => ({
                id: p.id || p.product_id,
                name: p.name || p.title,
                retailer: p.retailer || p.merchant || (p.merchantName),
                _source: 'product'
            }));
        }
        
        async fetchCategories(query) {
            const url = `${this.options.categoriesUrl}?country=${this.options.country}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
            const data = await response.json();
            const categories = data.data || data.categories || data.items || [];
            const q = query.toLowerCase();
            return categories
                .filter(c => c.name && c.name.toLowerCase().includes(q))
                .slice(0, this.options.sourceLimit)
                .map(c => ({
                    id: c.id || c.category_id,
                    name: c.name,
                    _source: 'category'
                }));
        }
        
        filterRetailers(query) {
            const q = query.toLowerCase();
            return RETAILERS.filter(r => r.name.toLowerCase().includes(q))
                .slice(0, this.options.sourceLimit)
                .map(r => ({
                    id: r.id,
                    name: r.name,
                    icon: r.icon,
                    _source: 'retailer'
                }));
        }
        
        renderLoading() {
            this.listbox.innerHTML = '';
            const li = document.createElement('li');
            li.className = 'bw-autocomplete-item bw-autocomplete-item-loading';
            li.innerHTML = `
                <span class="bw-autocomplete-loading-spinner"></span>
                <span class="bw-autocomplete-loading-text">Searching...</span>
            `;
            this.listbox.appendChild(li);
            this.selectedIndex = -1;
            this.open();
        }
        
        renderEmpty() {
            this.listbox.innerHTML = '';
            const li = document.createElement('li');
            li.className = 'bw-autocomplete-item bw-autocomplete-item-empty';
            li.innerHTML = `
                <span class="bw-autocomplete-empty-icon"></span>
                <span class="bw-autocomplete-empty-text">No results found</span>
            `;
            this.listbox.appendChild(li);
            this.selectedIndex = -1;
            this.open();
        }
        
        renderError(message) {
            this.listbox.innerHTML = '';
            const li = document.createElement('li');
            li.className = 'bw-autocomplete-item bw-autocomplete-item-error';
            li.innerHTML = `
                <span class="bw-autocomplete-error-icon">!</span>
                <span class="bw-autocomplete-error-text">${this.escapeHtml(message || 'Something went wrong')}</span>
            `;
            this.listbox.appendChild(li);
            this.selectedIndex = -1;
            this.open();
        }
        
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        renderResults() {
            this.listbox.innerHTML = '';
            
            if (this.results.length === 0) {
                this.renderEmpty();
                return;
            }
            
            this.results.forEach((item, index) => {
                const li = document.createElement('li');
                li.setAttribute('role', 'option');
                li.setAttribute('id', `bw-autocomplete-option-${index}`);
                li.setAttribute('aria-selected', 'false');
                li.dataset.index = index;
                li.className = `bw-autocomplete-item bw-autocomplete-item-${item._type}`;
                
                if (item._type === 'retailer') {
                    li.innerHTML = `
                        <span class="bw-autocomplete-item-icon bw-autocomplete-item-icon-${item.icon}"></span>
                        <span class="bw-autocomplete-item-name">${item.name}</span>
                        <span class="bw-autocomplete-item-badge">Retailer</span>
                    `;
                } else if (item._type === 'category') {
                    li.innerHTML = `
                        <span class="bw-autocomplete-item-icon bw-autocomplete-item-icon-category"></span>
                        <span class="bw-autocomplete-item-name">${item.name}</span>
                        <span class="bw-autocomplete-item-badge">Category</span>
                    `;
                } else {
                    li.innerHTML = `
                        <span class="bw-autocomplete-item-name">${item.name}</span>
                        ${item.retailer ? `<span class="bw-autocomplete-item-meta">${item.retailer}</span>` : ''}
                    `;
                }
                
                li.addEventListener('mouseenter', () => this.setActiveIndex(index));
                li.addEventListener('mouseleave', () => this.setActiveIndex(-1));
                
                this.listbox.appendChild(li);
            });
            
            this.selectedIndex = -1;
            this.open();
        }
        
        open() {
            this.isOpen = true;
            this.listbox.hidden = false;
            this.container.setAttribute('aria-expanded', 'true');
        }
        
        close() {
            this.isOpen = false;
            this.selectedIndex = -1;
            this.listbox.hidden = true;
            this.container.setAttribute('aria-expanded', 'false');
        }
        
        handleKeydown(e) {
            const activeResults = this.flatResults.length > 0 ? this.flatResults : this.results;
            if (!this.isOpen) {
                if (e.key === 'ArrowDown' && activeResults.length > 0) {
                    e.preventDefault();
                    this.open();
                    this.setActiveIndex(0);
                    return;
                }
                return;
            }
            
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.setActiveIndex(Math.min(this.selectedIndex + 1, activeResults.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.setActiveIndex(Math.max(this.selectedIndex - 1, -1));
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (this.selectedIndex >= 0) {
                        const item = this.listbox.children[this.selectedIndex];
                        if (item && item.dataset.query) {
                            this.input.value = item.dataset.query;
                            this.saveSearch(item.dataset.query);
                            this.close();
                            this.input.focus();
                        } else if (item) {
                            this.selectItem(item);
                        }
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.close();
                    break;
                case 'Tab':
                    this.close();
                    break;
            }
        }
        
        setActiveIndex(index) {
            const items = this.listbox.querySelectorAll('[role="option"]');
            
            items.forEach((item, i) => {
                item.classList.toggle('bw-autocomplete-option-active', i === index);
                item.setAttribute('aria-selected', i === index);
            });
            
            this.selectedIndex = index;
            
            if (index >= 0) {
                const activeItem = items[index];
                if (activeItem) {
                    activeItem.scrollIntoView({ block: 'nearest' });
                }
            }
        }
        
        selectItem(item) {
            const index = parseInt(item.dataset.index, 10);
            const result = (this.flatResults.length > 0 ? this.flatResults : this.results)[index];
            
            if (!result) return;
            
            if (this.options.onSelect) {
                this.options.onSelect(result, index);
            }
            
            if (this.options.onResultClick) {
                this.options.onResultClick({
                    item: result,
                    index: index,
                    type: result._type,
                    query: this.input.value
                });
            }
            
            if (result._type === 'recent' || result._type === 'trending') {
                this.input.value = result.name;
                this.saveSearch(result.name);
            } else {
                this.input.value = result.name;
            }
            this.close();
            this.input.focus();
        }
        
        handleFocus() {
            if (this.results.length > 0 && this.isOpen) {
                this.open();
            }
        }
        
        handleBlur() {
            setTimeout(() => {
                if (!this.listbox.matches(':focus-within')) {
                    this.close();
                }
            }, 150);
        }
        
        destroy() {
            clearTimeout(this.debounceTimer);
            const parent = this.container.parentNode;
            parent.insertBefore(this.input, this.container);
            this.container.remove();
        }
    }
    
    window.BwAutocomplete = Autocomplete;
})();