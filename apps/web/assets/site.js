// Progressive enhancement only: the page is complete and readable without JavaScript.
(function () {
  var cfg = window.ROWPROOF_CONFIG || {};
  var email = cfg.contactEmail || '';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- CTAs and config
  function mailto(subject, body) {
    return 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  var BRIEF =
    'Hello RowProof,\n\n' +
    'Application:\n' +
    'Supabase (hosted or self-hosted):\n' +
    'Tables holding per-customer data:\n' +
    'Who should be able to read what (one line per rule is fine):\n' +
    'Next release date:\n' +
    'Existing RLS tests (pgTAP, app tests, none):\n\n' +
    'Please do not include credentials or customer data; RowProof never needs them.\n';
  var offers = { boundaryCheck: 'Boundary Check', releaseAssurance: 'Release Assurance', agency: 'Agency plan', book: 'Call request' };

  document.querySelectorAll('[data-cta]').forEach(function (el) {
    var key = el.getAttribute('data-cta');
    var link = (cfg.checkout && cfg.checkout[key]) || '';
    if (key === 'book' && cfg.bookingUrl) link = cfg.bookingUrl;
    if (!link && email) link = mailto('RowProof: ' + (offers[key] || 'Boundary Check'), BRIEF);
    if (link) el.setAttribute('href', link);
    if (/^https?:/.test(link)) el.setAttribute('rel', 'noopener');
  });
  document.querySelectorAll('[data-repo]').forEach(function (el) { if (cfg.repoUrl) el.setAttribute('href', cfg.repoUrl); });
  document.querySelectorAll('[data-email]').forEach(function (el) {
    if (email) { el.textContent = email; el.setAttribute('href', 'mailto:' + email); }
  });
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });

  // ---------------------------------------------------------------- nav
  var nav = document.getElementById('nav');
  var toggle = document.querySelector('.nav__toggle');
  function onScroll() { if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 24); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('nav--open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('.nav__links a').forEach(function (a) {
      a.addEventListener('click', function () { nav.classList.remove('nav--open'); toggle.setAttribute('aria-expanded', 'false'); });
    });
  }

  // ---------------------------------------------------------------- copy
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-copy'));
      if (!target || !navigator.clipboard) return;
      var text = target.innerText.replace(/^\$ /gm, '');
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1400);
      }, function () {});
    });
  });

  if (reduceMotion) return;

  // ---------------------------------------------------------------- reveal on scroll
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return; // already on screen: leave visible
      el.classList.add('reveal--armed');
      io.observe(el);
    });
  }

  // ---------------------------------------------------------------- glass sheen follows the pointer
  if (window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.rp-glass').forEach(function (el) {
      el.addEventListener('pointermove', function (ev) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((ev.clientX - r.left) / r.width) * 100 + '%');
        el.style.setProperty('--my', ((ev.clientY - r.top) / r.height) * 100 + '%');
      });
      el.addEventListener('pointerleave', function () { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); });
    });
  }

  // ---------------------------------------------------------------- report frame settles as it scrolls into view
  var frame = document.getElementById('frame');
  if (frame) {
    var tick = false;
    var update = function () {
      tick = false;
      var r = frame.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, 1 - (r.top + r.height * 0.3) / window.innerHeight));
      frame.style.setProperty('--tilt', (8 * (1 - p)).toFixed(2) + 'deg');
      frame.style.transform = 'perspective(1400px) rotateX(' + (8 * (1 - p)).toFixed(2) + 'deg) rotateY(' + (-4 * (1 - p)).toFixed(2) + 'deg)';
    };
    window.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // ---------------------------------------------------------------- the ledger lens
  var body = document.getElementById('rows');
  var lens = document.getElementById('lens');
  var verdict = document.getElementById('verdict');
  var relLabel = document.querySelector('#rel b');
  var relNote = document.getElementById('rel-note');
  var releaseList = document.getElementById('releases');
  if (!body || !lens || !verdict || !releaseList) return;

  var rows = Array.prototype.slice.call(body.querySelectorAll('.lrow'));
  var RELEASES = [
    { r: 41, note: 'approved baseline', leakRow: -1 },
    { r: 42, note: 'policy edited by an AI-assisted PR', leakRow: 4 },
    { r: 43, note: 'policy fixed, re-checked', leakRow: -1 },
  ];
  var STEP = 760;
  var HOLD = 3000;
  var running = false;
  var visible = false;
  var timer = null;
  var pending = null;

  function wait(ms) {
    return new Promise(function (resolve) {
      pending = resolve;
      timer = setTimeout(function () { pending = null; resolve(); }, ms);
    });
  }
  function interrupt() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending) { var p = pending; pending = null; p(); }
  }
  function relItem(r) { return releaseList.querySelector('[data-r="' + r + '"]'); }
  function setRel(r, state, text) {
    var li = relItem(r);
    if (!li) return;
    li.setAttribute('data-state', state);
    li.querySelector('span').textContent = text;
  }
  function resetRows() {
    rows.forEach(function (row) {
      row.classList.remove('is-done', 'ok-own', 'ok-hidden', 'leak');
      row.querySelector('.lrow__res').lastChild.textContent = row.getAttribute('data-own') === '1' ? 'Returned to owner' : 'Not disclosed';
    });
  }
  function moveLens(i) {
    lens.style.setProperty('--lens-y', rows[i].offsetTop + 'px');
  }

  async function play() {
    if (running) return;
    running = true;
    while (visible) {
      RELEASES.forEach(function (x) { setRel(x.r, '', '—'); });
      for (var k = 0; k < RELEASES.length && visible; k++) {
        var rel = RELEASES[k];
        resetRows();
        relLabel.textContent = 'Release ' + rel.r;
        relNote.textContent = rel.note;
        verdict.setAttribute('data-state', 'scanning');
        verdict.textContent = 'Checking';
        setRel(rel.r, 'current', 'Checking');
        moveLens(0);
        lens.classList.remove('is-off');
        var leaked = false;
        for (var i = 0; i < rows.length && visible; i++) {
          moveLens(i);
          await wait(STEP);
          var row = rows[i];
          var res = row.querySelector('.lrow__res').lastChild;
          if (i === rel.leakRow) {
            row.classList.add('is-done', 'leak');
            res.textContent = 'Disclosed to Alice';
            leaked = true;
          } else {
            row.classList.add('is-done', row.getAttribute('data-own') === '1' ? 'ok-own' : 'ok-hidden');
          }
        }
        if (!visible) break;
        await wait(260);
        lens.classList.add('is-off');
        verdict.setAttribute('data-state', leaked ? 'fail' : 'pass');
        verdict.textContent = leaked ? 'Fail · exit 1' : 'Pass · exit 0';
        setRel(rel.r, leaked ? 'fail' : 'pass', leaked ? 'Leak caught' : rel.r === 43 ? 'Fixed · Pass' : 'Pass');
        await wait(HOLD);
      }
    }
    running = false;
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) play();
      else interrupt();
    }, { threshold: 0.25 }).observe(document.getElementById('ledger'));
  }
  window.addEventListener('resize', function () {
    var current = rows.findIndex(function (r) { return !r.classList.contains('is-done'); });
    if (current >= 0) moveLens(current);
  });
})();
