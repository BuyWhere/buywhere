(function() {
  'use strict';

  function initNav() {
    var header = document.querySelector('.nav-header');
    if (!header) return;

    var mobileToggle = header.querySelector('.nav-mobile-toggle');
    var mobileMenu = header.querySelector('.nav-mobile-menu');
    var backdrop = header.querySelector('.nav-backdrop');
    var desktopDropdowns = header.querySelectorAll('.nav-dropdown');
    var mobileDropdowns = header.querySelectorAll('.nav-mobile-dropdown-trigger');

    function closeAllDesktopDropdowns() {
      desktopDropdowns.forEach(function(dd) {
        var trigger = dd.querySelector('.nav-dropdown-trigger');
        var menu = dd.querySelector('.nav-dropdown-menu');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        if (menu) menu.classList.remove('is-open');
      });
    }

    function closeMobileMenu() {
      if (mobileMenu) mobileMenu.classList.remove('is-open');
      if (backdrop) backdrop.classList.remove('is-visible');
      if (mobileToggle) {
        mobileToggle.setAttribute('aria-expanded', 'false');
      }
      document.documentElement.classList.remove('nav-open');
    }

    function openMobileMenu() {
      if (mobileMenu) mobileMenu.classList.add('is-open');
      if (backdrop) backdrop.classList.add('is-visible');
      if (mobileToggle) {
        mobileToggle.setAttribute('aria-expanded', 'true');
      }
      document.documentElement.classList.add('nav-open');
    }

    if (mobileToggle && mobileMenu) {
      mobileToggle.addEventListener('click', function() {
        var isOpen = mobileMenu.classList.contains('is-open');
        if (isOpen) {
          closeMobileMenu();
        } else {
          openMobileMenu();
        }
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', closeMobileMenu);
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeMobileMenu();
        closeAllDesktopDropdowns();
      }
    });

    desktopDropdowns.forEach(function(dd) {
      var trigger = dd.querySelector('.nav-dropdown-trigger');
      var menu = dd.querySelector('.nav-dropdown-menu');
      if (!trigger || !menu) return;

      trigger.addEventListener('click', function(e) {
        e.preventDefault();
        var isOpen = trigger.getAttribute('aria-expanded') === 'true';
        closeAllDesktopDropdowns();
        if (!isOpen) {
          trigger.setAttribute('aria-expanded', 'true');
          menu.classList.add('is-open');
        }
      });

      trigger.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          trigger.click();
        }
      });

      var menuItems = menu.querySelectorAll('a');
      if (menuItems.length > 0) {
        menuItems[0].addEventListener('keydown', function(e) {
          if (e.key === 'Tab' && e.shiftKey) {
          } else if (e.key === 'Tab' && !e.shiftKey) {
            closeAllDesktopDropdowns();
          }
        });
      }
    });

    document.addEventListener('click', function(e) {
      if (!header.contains(e.target)) {
        closeAllDesktopDropdowns();
      }
    });

    mobileDropdowns.forEach(function(trigger) {
      var dropdown = trigger.closest('.nav-mobile-dropdown');
      var menu = dropdown ? dropdown.querySelector('.nav-mobile-dropdown-menu') : null;
      if (!dropdown || !menu) return;

      trigger.addEventListener('click', function(e) {
        e.preventDefault();
        var isOpen = trigger.getAttribute('aria-expanded') === 'true';
        if (isOpen) {
          trigger.setAttribute('aria-expanded', 'false');
          menu.classList.remove('is-open');
          trigger.classList.remove('is-active');
        } else {
          trigger.setAttribute('aria-expanded', 'true');
          menu.classList.add('is-open');
          trigger.classList.add('is-active');
        }
      });
    });

    var currentPath = window.location.pathname;
    var allLinks = header.querySelectorAll('a');
    allLinks.forEach(function(link) {
      var href = link.getAttribute('href');
      if (!href) return;
      if (href === '/') {
        if (currentPath === '/' || currentPath === '') {
          link.classList.add('is-active');
        }
      } else if (currentPath.startsWith(href) && href !== '/') {
        link.classList.add('is-active');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();