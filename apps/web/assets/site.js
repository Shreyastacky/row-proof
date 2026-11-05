// Pyx site behaviour. Progressive enhancement: every page is complete without JavaScript.
(function () {
  'use strict';
  var cfg = window.PYX_CONFIG || {};
  var email = cfg.contactEmail || '';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------------------------------------------------------------- links from config
  var BRIEF =
    'Hi,\n\nApp:\nSupabase (hosted or self-hosted):\nTables with customer data:\nWho should see what (a line per rule is fine):\nAPI routes or RPC functions that return those records:\nNext release date:\n\nPlease leave out credentials and customer data. Pyx never needs them.\n';
  var OFFERS = { boundaryCheck: 'Setup', releaseAssurance: 'Release review', agency: 'Agency plan', book: 'Setup' };
  function mailto(subject) {
    return 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(BRIEF);
  }
  document.querySelectorAll('[data-cta]').forEach(function (el) {
    var key = el.getAttribute('data-cta');
    var link = (cfg.checkout && cfg.checkout[key]) || '';
    if (key === 'book' && cfg.bookingUrl) link = cfg.bookingUrl;
    if (!link && email) link = mailto('Pyx: ' + (OFFERS[key] || 'Setup'));
    if (link) el.setAttribute('href', link);
    if (/^https?:/.test(link)) el.setAttribute('rel', 'noopener');
  });
  document.querySelectorAll('[data-repo]').forEach(function (el) { if (cfg.repoUrl) el.setAttribute('href', cfg.repoUrl + (el.getAttribute('data-repo') || '')); });
  document.querySelectorAll('[data-email]').forEach(function (el) { if (email) { el.textContent = email; el.setAttribute('href', 'mailto:' + email); } });
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
  document.querySelectorAll('[data-copy-text]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!navigator.clipboard) return;
      var label = btn.querySelector('.cmd__c') || btn;
      var before = label.textContent;
      navigator.clipboard.writeText(btn.getAttribute('data-copy-text')).then(function () {
        label.textContent = 'copied';
        setTimeout(function () { label.textContent = before; }, 1400);
      }, function () {});
    });
  });

  // ---------------------------------------------------------------- nav: clear at the top, glass once content passes under it
  var nav = document.getElementById('nav');
  if (nav) {
    var setNav = function () { nav.classList.toggle('nav--top', window.scrollY < 24); };
    setNav();
    window.addEventListener('scroll', setNav, { passive: true });
  }

  // ---------------------------------------------------------------- the ledger
  var PATHS = [['/rest/v1/invoices', 'db'], ['/rpc/get_invoice', 'rpc'], ['/api/invoices/:id', 'api']];
  var WHO = ['alice', 'bob', 'anonymous'];
  var OWNER = { 'inv_a': 'alice', 'inv_b': 'bob' };
  var rows = [];
  PATHS.forEach(function (p) {
    WHO.forEach(function (w) {
      ['inv_a', 'inv_b'].forEach(function (rec) {
        var leak = p[1] === 'api' && w !== 'anonymous' && OWNER[rec] !== w;
        var meaning = leak ? 'LEAKED' : OWNER[rec] === w ? 'own record' : 'hidden';
        rows.push({ who: w, rec: rec, path: p[0], meaning: meaning, leak: leak });
      });
    });
  });
  function rowHtml(r, reveal) {
    var cls = r.leak ? 'v-leak' : r.meaning === 'own record' ? 'v-own' : 'v-held';
    return '<div class="ledger__row' + (reveal && r.leak ? ' ledger__row--leak' : '') + '"><span>' + r.who + '</span><span>' + r.rec + '</span><span>' + r.path + '</span><span>200</span><span class="' + (reveal ? cls : 'v-ok') + '">' + (reveal ? r.meaning : 'OK') + '</span></div>';
  }
  var ledger = document.getElementById('ledger');
  var base = document.getElementById('ledger-base');
  var mag = document.getElementById('ledger-mag');
  var magBox = document.getElementById('lens-mag');
  var lens = document.getElementById('lens');
  var lensIn = document.getElementById('lens-in');
  if (ledger && base && mag && lens && magBox) {
    base.innerHTML = rows.map(function (r) { return rowHtml(r, false); }).join('');
    mag.innerHTML = rows.map(function (r) { return rowHtml(r, true); }).join('');
    var SCALE = 1.3;
    var pos = { x: 0, y: 0 }, target = { x: 0, y: 0 };
    var R = 110, W = 0, H = 0;
    var measure = function () {
      W = ledger.clientWidth;
      H = base.offsetTop + base.offsetHeight;
      R = lens.offsetWidth / 2;
      magBox.style.width = W + 'px';
    };
    measure();
    // Parked on the first leak, so the point is made even before anyone moves the pointer.
    var leakRows = [];
    base.querySelectorAll('.ledger__row').forEach(function (el, i) { if (rows[i].leak) leakRows.push(el); });
    var park = function (i) {
      var el = leakRows[i % leakRows.length] || base.firstChild;
      target.x = W - R * 1.15;
      target.y = base.offsetTop + el.offsetTop + el.offsetHeight / 2;
    };
    park(0);
    pos.x = target.x; pos.y = target.y;
    var place = function () {
      var x = Math.max(R, Math.min(W - R, pos.x));
      var y = Math.max(R * 0.4, Math.min(H - R * 0.2, pos.y));
      ledger.style.setProperty('--lx', x + 'px');
      ledger.style.setProperty('--ly', y + 'px');
      magBox.style.transform = 'translate(' + (R - SCALE * x) + 'px,' + (R - SCALE * y) + 'px) scale(' + SCALE + ')';
    };
    place();
    window.addEventListener('resize', function () { measure(); place(); });

    // Real refraction at the rim in Chromium: an SVG displacement map built for this lens.
    var brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    var chromium = brands.some(function (b) { return /Chromium/.test(b.brand); });
    var map = document.getElementById('lens-map');
    if (chromium && map && lensIn) {
      var size = Math.round(R * 2), c = document.createElement('canvas');
      c.width = size; c.height = size;
      var g = c.getContext('2d'), img = g.createImageData(size, size), band = R * 0.3;
      for (var j = 0; j < size; j++) {
        for (var i = 0; i < size; i++) {
          var dx = i + 0.5 - R, dy = j + 0.5 - R, d = Math.sqrt(dx * dx + dy * dy), depth = R - d;
          var k = depth >= 0 && depth < band ? Math.pow(1 - depth / band, 2.2) : 0;
          var nx = d ? dx / d : 0, ny = d ? dy / d : 0, o = (j * size + i) * 4;
          img.data[o] = 128 - nx * k * 127; img.data[o + 1] = 128 - ny * k * 127; img.data[o + 2] = 128; img.data[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      map.setAttribute('href', c.toDataURL());
      map.setAttribute('width', String(size));
      map.setAttribute('height', String(size));
      lensIn.style.filter = 'url(#lens-refract)';
    }

    if (reduce) {
      ledger.classList.add('ledger--static');
    } else {
      var lastMove = -1e9, wander = 0;
      if (finePointer) {
        ledger.addEventListener('pointermove', function (e) {
          var r = ledger.getBoundingClientRect();
          target.x = e.clientX - r.left;
          target.y = e.clientY - r.top;
          lastMove = performance.now();
        });
        ledger.addEventListener('pointerleave', function () { lastMove = performance.now() - 2000; });
      } else {
        ledger.classList.add('ledger--static');
        ledger.addEventListener('click', function (e) {
          var r = ledger.getBoundingClientRect();
          target.x = e.clientX - r.left; target.y = e.clientY - r.top; lastMove = performance.now();
        });
      }
      var visible = true;
      if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(ledger);
      var t0 = performance.now();
      var tick = function (now) {
        requestAnimationFrame(tick);
        if (!visible || document.hidden) return;
        // Idle: drift through the ledger and come to rest on each leak in turn.
        if (now - lastMove > 2600) {
          var phase = ((now - t0) / 1000) % 9;
          if (phase < 0.05) wander++;
          if (phase < 4.2) park(wander);
          else {
            var s = (phase - 4.2) / 4.8;
            target.x = W * (0.3 + 0.45 * Math.sin(s * Math.PI * 2 + 0.6) * 0.5 + 0.2);
            target.y = base.offsetTop + (base.offsetHeight - 40) * (0.12 + 0.76 * s);
          }
        }
        // Spring-ish follow: fast to start, soft to settle.
        pos.x += (target.x - pos.x) * 0.12;
        pos.y += (target.y - pos.y) * 0.12;
        place();
      };
      requestAnimationFrame(tick);
    }
  }

  // ---------------------------------------------------------------- release review window
  var ROUTES = ['Database API', 'RPC', 'API route'];
  var PAIRS = [['Alice', 'her invoice'], ['Alice', 'Bob’s invoice'], ['Bob', 'Alice’s invoice'], ['Anonymous', 'any invoice']];
  // Per pair and route: R = owner reads it, H = hidden, L = leaked.
  var RELEASES = {
    43: { pass: true, title: 'Scope export by owner', vs: 42, commit: '9f2c1ab', exit: 0, grid: ['RRR', 'HHH', 'HHH', 'HHH'],
      changes: [['ok', 'Alice can no longer open Bob’s invoice', 'The export route now checks who is asking.', 'GET /api/invoices/:id'], ['ok', 'Bob can no longer open Alice’s invoice', 'Same fix, same route.', 'GET /api/invoices/:id'], ['ok', 'Everything else matches the approved rule', '18 checks on 3 paths, all held.', 'all paths']] },
    42: { pass: false, title: 'Add invoice export route', vs: 41, commit: 'c41e07d', exit: 1, grid: ['RRR', 'HHL', 'HHL', 'HHH'],
      changes: [['gain', 'Alice can now open Bob’s invoice', 'Expected: hidden from Alice. Got: the full record.', 'GET /api/invoices/:id'], ['gain', 'Bob can now open Alice’s invoice', 'Same route. The database rules still hold.', 'GET /api/invoices/:id'], ['ok', 'Database API and RPC unchanged', 'Each user still sees only their own invoice.', '/rest/v1']] },
    41: { pass: true, title: 'Billing page copy', vs: 40, commit: '2b77e90', exit: 0, grid: ['RRR', 'HHH', 'HHH', 'HHH'],
      changes: [['ok', 'No one gained or lost access', 'The policy fix from release 40 holds.', 'all paths'], ['ok', 'Anonymous visitors see nothing', 'No session, no rows, on every path.', 'all paths']] },
    40: { pass: false, title: 'Simplify invoice policy', vs: 39, commit: '7da03f4', exit: 1, grid: ['RRR', 'LHH', 'LHH', 'HHH'],
      changes: [['gain', 'Alice can now open Bob’s invoice', 'A policy edit let any signed-in user read every invoice.', 'GET /rest/v1/invoices'], ['gain', 'Bob can now open Alice’s invoice', 'Same policy, same door.', 'GET /rest/v1/invoices'], ['ok', 'RPC and API route unaffected', 'Both check the caller themselves.', 'rpc · /api']] },
  };
  var pane = document.getElementById('pane');
  var rels = document.getElementById('rels');
  var tabs = document.querySelector('.tabs');
  var current = { rel: '42', view: 'changes' };
  var autoplay = !reduce;

  function renderView(r) {
    if (current.view === 'changes') {
      return '<ul class="changes">' + r.changes.map(function (c) {
        return '<li class="change change--' + c[0] + '"><span class="change__text"><b>' + esc(c[1]) + '</b><small>' + esc(c[2]) + '</small></span><span class="route">' + esc(c[3]) + '</span></li>';
      }).join('') + '</ul>';
    }
    if (current.view === 'matrix') {
      var html = '<div class="paths-grid"><span></span>' + ROUTES.map(function (x) { return '<span class="h">' + x + '</span>'; }).join('');
      PAIRS.forEach(function (p, i) {
        html += '<span class="a">' + esc(p[0]) + '<small>' + esc(p[1]) + '</small></span>';
        for (var k = 0; k < 3; k++) {
          var v = r.grid[i][k];
          html += v === 'L' ? '<span class="cell cell--leak">leaked</span>' : v === 'R' ? '<span class="cell cell--own">reads</span>' : '<span class="cell cell--pass">hidden</span>';
        }
      });
      return html + '</div>';
    }
    return '<dl class="evidence-dl"><dt>Rule</dt><dd>invoice-three-paths · revision 1 · sha256:87ed8886…</dd><dt>Commit</dt><dd>' + r.commit + '</dd><dt>Target</dt><dd>local copy built from migrations</dd><dt>Paths</dt><dd>/rest/v1/invoices · /rest/v1/rpc/get_invoice · /api/invoices/:id</dd><dt>Checks</dt><dd>18 (6 per path) · 23 requests, all logged</dd><dt>Exit code</dt><dd>' + r.exit + (r.exit ? ' · merge blocked' : ' · merge allowed') + '</dd></dl>';
  }
  function moveThumb() {
    var t = tabs && tabs.querySelector('[aria-selected="true"]');
    var tt = tabs && tabs.querySelector('.tabs__thumb');
    if (t && tt) { tt.style.width = t.offsetWidth + 'px'; tt.style.transform = 'translateX(' + (t.offsetLeft - 3) + 'px)'; }
  }
  function render() {
    var r = RELEASES[current.rel];
    pane.innerHTML =
      '<div class="pane__head"><h3>Release ' + current.rel + '</h3><span class="status ' + (r.pass ? 'status--pass">Passed' : 'status--leak">Build failed') + '</span></div>' +
      '<p class="pane__sub">' + esc(r.title) + ' · compared with release ' + r.vs + '</p><div class="view">' + renderView(r) + '</div>';
    rels.querySelectorAll('.rel').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-rel') === current.rel ? 'true' : 'false'); });
    tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-view') === current.view ? 'true' : 'false'); });
    moveThumb();
  }
  if (pane && rels && tabs) {
    rels.addEventListener('click', function (e) {
      var b = e.target.closest('.rel'); if (!b) return;
      autoplay = false; current.rel = b.getAttribute('data-rel'); render();
    });
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      autoplay = false; current.view = b.getAttribute('data-view'); render();
    });
    window.addEventListener('resize', moveThumb);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveThumb);
    render();
    var order = ['42', '43', '40', '41'], step = 0, inView = false;
    var win = document.getElementById('window');
    if ('IntersectionObserver' in window && win) new IntersectionObserver(function (es) { inView = es[0].isIntersecting; }, { threshold: 0.5 }).observe(win);
    setInterval(function () {
      if (!autoplay || !inView || document.hidden) return;
      step = (step + 1) % (order.length * 2);
      current.rel = order[Math.floor(step / 2)];
      current.view = step % 2 === 0 ? 'changes' : 'matrix';
      render();
    }, 4200);
  }

  // ---------------------------------------------------------------- reveal on scroll
  if (!reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('reveal--armed'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
      el.classList.add('reveal--armed');
      io.observe(el);
    });
  }
})();
