// Pyx site behaviour. Progressive enhancement: the page is complete without JavaScript.
(function () {
  'use strict';
  var cfg = window.PYX_CONFIG || {};
  var email = cfg.contactEmail || '';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---------------------------------------------------------------- links from config
  var BRIEF =
    'Hi,\n\nApp:\nSupabase (hosted or self-hosted):\nTables with customer data:\nWho should see what (a line per rule is fine):\nAPI routes or RPC functions that return those records:\nNext release date:\n\nPlease leave out credentials and customer data. Pyx never needs them.\n';
  var OFFERS = { boundaryCheck: 'Setup', releaseAssurance: 'Release review', agency: 'Agency plan', book: 'Call' };
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
  document.querySelectorAll('[data-repo]').forEach(function (el) { if (cfg.repoUrl) el.setAttribute('href', cfg.repoUrl); });
  document.querySelectorAll('[data-email]').forEach(function (el) { if (email) { el.textContent = email; el.setAttribute('href', 'mailto:' + email); } });
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var t = document.getElementById(btn.getAttribute('data-copy'));
      if (!t || !navigator.clipboard) return;
      navigator.clipboard.writeText(t.innerText.replace(/^\$ /gm, '')).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1400);
      }, function () {});
    });
  });

  // ---------------------------------------------------------------- release review window
  var ICON_GAIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5l4 4L18 8"/></svg>';
  var ROUTES = ['Database API', 'RPC', 'API route'];
  var PAIRS = [
    ['Alice', 'her invoice'],
    ['Alice', 'Bob’s invoice'],
    ['Bob', 'Alice’s invoice'],
    ['Anonymous', 'any invoice'],
  ];
  // Cell values per pair and route: R = returned to owner, H = hidden, L = leaked.
  var RELEASES = {
    43: {
      pass: true, title: 'Scope export by owner', vs: 42,
      changes: [
        ['ok', 'Alice can no longer open Bob’s invoice', 'The export route now checks who is asking.', 'GET /api/invoices/:id'],
        ['ok', 'Bob can no longer open Alice’s invoice', 'Same fix, same route.', 'GET /api/invoices/:id'],
        ['ok', 'Everything else matches the approved rule', '6 checks on 3 paths, all passed.', 'all paths'],
      ],
      grid: ['RRR', 'HHH', 'HHH', 'HHH'], commit: '9f2c1ab', exit: 0,
    },
    42: {
      pass: false, title: 'Add invoice export route', vs: 41,
      changes: [
        ['gain', 'Alice can now open Bob’s invoice', 'Expected: hidden from Alice. Got: the full record.', 'GET /api/invoices/:id'],
        ['gain', 'Bob can now open Alice’s invoice', 'Same route. The database rules still hold.', 'GET /api/invoices/:id'],
        ['ok', 'Database API and RPC unchanged', 'Each user still sees only their own invoice.', '/rest/v1'],
      ],
      grid: ['RRR', 'HHL', 'HHL', 'HHH'], commit: 'c41e07d', exit: 1,
    },
    41: {
      pass: true, title: 'Billing page copy', vs: 40,
      changes: [
        ['ok', 'No one gained or lost access', 'The policy fix from release 40 holds.', 'all paths'],
        ['ok', 'Anonymous visitors see nothing', 'No session, no rows, on every path.', 'all paths'],
      ],
      grid: ['RRR', 'HHH', 'HHH', 'HHH'], commit: '2b77e90', exit: 0,
    },
    40: {
      pass: false, title: 'Simplify invoice policy', vs: 39,
      changes: [
        ['gain', 'Alice can now open Bob’s invoice', 'A policy edit let any signed-in user read every invoice.', 'GET /rest/v1/invoices'],
        ['gain', 'Bob can now open Alice’s invoice', 'Same policy, same door.', 'GET /rest/v1/invoices'],
        ['ok', 'RPC and API route unaffected', 'Both check the caller themselves.', 'rpc · /api'],
      ],
      grid: ['RRR', 'LHH', 'LHH', 'HHH'], commit: '7da03f4', exit: 1,
    },
  };

  var pane = document.getElementById('pane');
  var rels = document.getElementById('rels');
  var tabs = document.querySelector('.tabs');
  var current = { rel: '42', view: 'changes' };
  var autoplay = !reduce;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderView(r) {
    if (current.view === 'changes') {
      return '<ul class="changes">' + r.changes.map(function (c) {
        return '<li class="change change--' + c[0] + '"><span class="change__icon">' + (c[0] === 'gain' ? ICON_GAIN : ICON_OK) + '</span><span class="change__text"><b>' + esc(c[1]) + '</b><small>' + esc(c[2]) + '</small></span><span class="route">' + esc(c[3]) + '</span></li>';
      }).join('') + '</ul>';
    }
    if (current.view === 'matrix') {
      var html = '<div class="paths-grid"><span></span>' + ROUTES.map(function (x) { return '<span class="h">' + x + '</span>'; }).join('');
      PAIRS.forEach(function (p, i) {
        html += '<span class="a">' + esc(p[0]) + '<small>' + esc(p[1]) + '</small></span>';
        for (var k = 0; k < 3; k++) {
          var v = r.grid[i][k];
          html += v === 'L' ? '<span class="cell cell--leak">Leaked</span>' : '<span class="cell cell--pass">' + (v === 'R' ? 'Returned' : 'Hidden') + '</span>';
        }
      });
      return html + '</div>';
    }
    return '<dl class="evidence-dl"><dt>Rule</dt><dd>invoice-owner-read · revision 1 · sha256:d46d8274…</dd><dt>Commit</dt><dd>' + r.commit + '</dd><dt>Target</dt><dd>local copy from migrations</dd><dt>Paths</dt><dd>/rest/v1/invoices · /rest/v1/rpc/get_invoice · /api/invoices/:id</dd><dt>Checks</dt><dd>18 (6 per path)</dd><dt>Exit code</dt><dd>' + r.exit + (r.exit ? ' · build blocked' : ' · build allowed') + '</dd><dt>Report</dt><dd>invoice-owner-read.html</dd></dl>';
  }

  function moveThumbs() {
    var t = tabs && tabs.querySelector('[aria-selected="true"]');
    var tt = tabs && tabs.querySelector('.tabs__thumb');
    if (t && tt) { tt.style.width = t.offsetWidth + 'px'; tt.style.transform = 'translateX(' + t.offsetLeft + 'px)'; }
    var b = rels && rels.querySelector('[aria-pressed="true"]');
    var rt = rels && rels.querySelector('.rels__thumb');
    if (b && rt) { rt.style.height = b.offsetHeight + 'px'; rt.style.transform = 'translateY(' + b.offsetTop + 'px)'; }
  }

  function render() {
    var r = RELEASES[current.rel];
    pane.innerHTML =
      '<div class="pane__head"><h3>Release ' + current.rel + '</h3><span class="status ' + (r.pass ? 'status--pass">Passed' : 'status--leak">Build failed') + '</span></div>' +
      '<p class="pane__sub">' + esc(r.title) + ' · compared with release ' + r.vs + '</p>' +
      '<div class="view">' + renderView(r) + '</div>';
    rels.querySelectorAll('.rel').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-rel') === current.rel ? 'true' : 'false'); });
    tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-view') === current.view ? 'true' : 'false'); });
    moveThumbs();
  }

  if (pane && rels && tabs) {
    rels.addEventListener('click', function (e) {
      var b = e.target.closest('.rel');
      if (!b) return;
      autoplay = false;
      current.rel = b.getAttribute('data-rel');
      render();
    });
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      autoplay = false;
      current.view = b.getAttribute('data-view');
      render();
    });
    window.addEventListener('resize', moveThumbs);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveThumbs);
    moveThumbs();

    // Gentle autoplay through the story until the visitor takes over.
    var order = ['42', '43', '40', '41'];
    var step = 0;
    var windowEl = document.getElementById('window');
    var inView = true;
    if ('IntersectionObserver' in window && windowEl) {
      new IntersectionObserver(function (es) { inView = es[0].isIntersecting; }, { threshold: 0.4 }).observe(windowEl);
    }
    setInterval(function () {
      if (!autoplay || !inView || document.hidden) return;
      step = (step + 1) % (order.length * 2);
      // Alternate views on the failing releases so both stories are seen.
      current.rel = order[Math.floor(step / 2)];
      current.view = step % 2 === 0 ? 'changes' : 'matrix';
      render();
    }, 4200);
  }

  if (reduce) return;

  // ---------------------------------------------------------------- headline words
  var h1 = document.getElementById('headline');
  if (h1) {
    var words = h1.textContent.trim().split(/\s+/);
    h1.innerHTML = words.map(function (w, i) { return '<span class="w" style="--i:' + i + '">' + esc(w) + '</span>'; }).join(' ');
  }

  // ---------------------------------------------------------------- living field
  var canvas = document.getElementById('field');
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, scale = 0.25;
    var pointer = { x: 0.5, y: 0.3, tx: 0.5, ty: 0.3 };
    // Warm and cool sources sit in opposite corners so they never mix into a muddy middle.
    var blobs = [
      { c: '255,112,104', x: 0.1, y: 0.16, r: 0.4, sx: 0.07, sy: 0.05, p: 0 },
      { c: '96,140,255', x: 0.9, y: 0.12, r: 0.46, sx: 0.06, sy: 0.06, p: 1.7 },
      { c: '64,214,178', x: 0.84, y: 0.88, r: 0.46, sx: 0.08, sy: 0.05, p: 3.1 },
      { c: '150,110,255', x: 0.14, y: 0.9, r: 0.4, sx: 0.05, sy: 0.07, p: 4.4 },
      { c: '80,170,255', x: 0.55, y: 0.55, r: 0.26, sx: 0.09, sy: 0.08, p: 2.2 },
    ];
    function size() {
      W = Math.max(1, Math.round(window.innerWidth * scale));
      H = Math.max(1, Math.round(window.innerHeight * scale));
      canvas.width = W;
      canvas.height = H;
    }
    size();
    window.addEventListener('resize', size);
    window.addEventListener('pointermove', function (e) { pointer.tx = e.clientX / window.innerWidth; pointer.ty = e.clientY / window.innerHeight; }, { passive: true });
    var last = 0;
    var scrollY = 0;
    window.addEventListener('scroll', function () { scrollY = window.scrollY; }, { passive: true });
    function frame(t) {
      requestAnimationFrame(frame);
      if (document.hidden || t - last < 33) return;
      last = t;
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      var s = t / 1000;
      var drift = (scrollY / Math.max(1, window.innerHeight)) * 0.06;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#07080c';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      blobs.forEach(function (b) {
        var x = (b.x + Math.sin(s * b.sx * 2 + b.p) * 0.12) * W;
        var y = (b.y + Math.cos(s * b.sy * 2 + b.p) * 0.1 - drift) * H;
        var r = b.r * Math.max(W, H);
        var g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(' + b.c + ',0.46)');
        g.addColorStop(1, 'rgba(' + b.c + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      });
      // A soft light that follows the pointer, so the glass has something to catch.
      var px = pointer.x * W, py = pointer.y * H, pr = 0.28 * Math.max(W, H);
      var pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
      pg.addColorStop(0, 'rgba(255,255,255,0.18)');
      pg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = pg;
      ctx.fillRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- refraction (Chromium)
  var brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  var chromium = brands.some(function (b) { return /Chromium/.test(b.brand); });
  var defs = document.getElementById('refract-defs');
  var NS = 'http://www.w3.org/2000/svg';
  function displacementMap(w, h, radius, band) {
    var sx = Math.max(1, Math.round(w / 2)), sy = Math.max(1, Math.round(h / 2));
    var c = document.createElement('canvas');
    c.width = sx; c.height = sy;
    var g = c.getContext('2d');
    var img = g.createImageData(sx, sy);
    var r = Math.min(radius, w / 2, h / 2);
    for (var j = 0; j < sy; j++) {
      for (var i = 0; i < sx; i++) {
        var x = (i + 0.5) * (w / sx) - w / 2, y = (j + 0.5) * (h / sy) - h / 2;
        var qx = Math.abs(x) - (w / 2 - r), qy = Math.abs(y) - (h / 2 - r);
        var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
        var outside = Math.sqrt(ox * ox + oy * oy);
        var d = outside + Math.min(Math.max(qx, qy), 0) - r; // signed distance, negative inside
        var depth = -d;
        var nx = 0, ny = 0, k = 0;
        if (depth >= 0 && depth < band) {
          k = Math.pow(1 - depth / band, 2);
          if (outside > 0) { nx = (ox / outside) * Math.sign(x); ny = (oy / outside) * Math.sign(y); }
          else if (qx > qy) { nx = Math.sign(x); } else { ny = Math.sign(y); }
        }
        var o = (j * sx + i) * 4;
        // Sample from further inside near the rim: the edge magnifies like a lens.
        img.data[o] = 128 - nx * k * 127;
        img.data[o + 1] = 128 - ny * k * 127;
        img.data[o + 2] = 128;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }
  if (chromium && defs) {
    var n = 0;
    document.querySelectorAll('[data-refract]').forEach(function (el) {
      var id = 'refract-' + n++;
      var build = function () {
        var w = el.offsetWidth, h = el.offsetHeight;
        if (!w || !h) return;
        var radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 24;
        var old = document.getElementById(id);
        if (old) old.remove();
        var f = document.createElementNS(NS, 'filter');
        f.setAttribute('id', id);
        f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
        f.setAttribute('filterUnits', 'userSpaceOnUse');
        f.setAttribute('color-interpolation-filters', 'sRGB');
        var im = document.createElementNS(NS, 'feImage');
        im.setAttribute('href', displacementMap(w, h, radius, Math.min(36, Math.min(w, h) / 3)));
        im.setAttribute('x', '0'); im.setAttribute('y', '0'); im.setAttribute('width', String(w)); im.setAttribute('height', String(h));
        im.setAttribute('preserveAspectRatio', 'none');
        im.setAttribute('result', 'map');
        var dm = document.createElementNS(NS, 'feDisplacementMap');
        dm.setAttribute('in', 'SourceGraphic'); dm.setAttribute('in2', 'map');
        dm.setAttribute('scale', String(Math.min(70, Math.max(24, Math.min(w, h) / 4))));
        dm.setAttribute('xChannelSelector', 'R'); dm.setAttribute('yChannelSelector', 'G');
        f.appendChild(im); f.appendChild(dm);
        defs.appendChild(f);
        el.style.setProperty('--glass-filter', 'url(#' + id + ') blur(10px) saturate(190%) brightness(1.06)');
      };
      build();
      if ('ResizeObserver' in window) {
        var tm = null;
        new ResizeObserver(function () { clearTimeout(tm); tm = setTimeout(build, 150); }).observe(el);
      }
    });
  }

  if (!finePointer) {
    revealOnScroll();
    return;
  }

  // ---------------------------------------------------------------- glass catches the light
  document.querySelectorAll('.glass').forEach(function (el) {
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--px', ((e.clientX - r.left) / r.width) * 100 + '%');
      el.style.setProperty('--py', ((e.clientY - r.top) / r.height) * 100 + '%');
    });
  });

  // ---------------------------------------------------------------- window tilt
  var stage = document.getElementById('stage');
  var win = document.getElementById('window');
  if (stage && win) {
    stage.addEventListener('pointermove', function (e) {
      var r = stage.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      win.style.setProperty('--ry', (x * 7).toFixed(2) + 'deg');
      win.style.setProperty('--rx', (-y * 5).toFixed(2) + 'deg');
    });
    stage.addEventListener('pointerleave', function () { win.style.setProperty('--ry', '0deg'); win.style.setProperty('--rx', '0deg'); });
  }

  // ---------------------------------------------------------------- magnetic buttons
  document.querySelectorAll('[data-magnetic]').forEach(function (el) {
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1) + 'px');
      el.style.setProperty('--my', ((e.clientY - r.top - r.height / 2) * 0.28).toFixed(1) + 'px');
    });
    el.addEventListener('pointerleave', function () { el.style.setProperty('--mx', '0px'); el.style.setProperty('--my', '0px'); });
  });

  revealOnScroll();

  function revealOnScroll() {
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('rise--armed'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.rise').forEach(function (el, i) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
      el.classList.add('rise--armed');
      el.style.transitionDelay = (i % 3) * 0.06 + 's';
      io.observe(el);
    });
  }
})();
