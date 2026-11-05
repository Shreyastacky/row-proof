// Progressive enhancement only: the page is fully readable without JavaScript.
(function () {
  var cfg = window.ROWPROOF_CONFIG || {};
  var email = cfg.contactEmail || '';

  function mailto(subject, body) {
    return 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  var BRIEF =
    'Hi RowProof,\n\n' +
    'App / product:\n' +
    'Supabase project type (hosted / self-hosted):\n' +
    'Tables with per-user data (e.g. invoices, notes):\n' +
    'Who should be able to read what (one line per rule is fine):\n' +
    'Next release date:\n' +
    'Do you already have RLS tests? (pgTAP, app tests, none):\n\n' +
    'No credentials or customer data please; RowProof never needs them.\n';

  var offers = {
    boundaryCheck: 'Boundary Check',
    releaseAssurance: 'Release Assurance',
    agency: 'Agency plan',
    contact: 'Question',
  };

  document.querySelectorAll('[data-cta]').forEach(function (el) {
    var key = el.getAttribute('data-cta');
    var link = (cfg.checkout && cfg.checkout[key]) || '';
    if (key === 'book' && cfg.bookingUrl) link = cfg.bookingUrl;
    if (!link && email) link = mailto('RowProof: ' + (offers[key] || 'Boundary Check'), BRIEF);
    if (link) el.setAttribute('href', link);
    if (/^https?:/.test(link)) el.setAttribute('rel', 'noopener');
  });
  document.querySelectorAll('[data-repo]').forEach(function (el) {
    if (cfg.repoUrl) el.setAttribute('href', cfg.repoUrl);
  });
  document.querySelectorAll('[data-email]').forEach(function (el) {
    if (email) {
      el.textContent = email;
      el.setAttribute('href', 'mailto:' + email);
    }
  });
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  var toggle = document.querySelector('.nav__toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('nav--open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('.nav__links a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('nav--open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-copy'));
      if (!target || !navigator.clipboard) return;
      navigator.clipboard.writeText(target.innerText.replace(/^\$ /gm, '')).then(function () {
        var old = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function () {
          btn.textContent = old;
        }, 1400);
      });
    });
  });

  // Reveal-on-scroll, skipped for reduced motion.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('reveal--armed');
      io.observe(el);
    });
  }
})();
