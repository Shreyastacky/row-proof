// Result verifier UI. All work happens on files the visitor opens; the CSP allows no outbound connections
// beyond this site (connect-src 'self'), which is only used to load the two sample files on request.
(function () {
  'use strict';
  var out = document.getElementById('out');
  var drop = document.getElementById('drop');
  var input = document.getElementById('files');
  if (!out || !drop || !input) return;
  var MAX = 2 * 1024 * 1024;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function uniq(xs) { return xs.filter(function (x, i) { return xs.indexOf(x) === i; }); }
  var OUTCOME = { pass: ['pill--pass', 'Pass'], fail: ['pill--fail', 'Fail'], blocked: ['pill--blocked', 'Blocked'] };
  var CHANGE = {
    gained_access: ['t-leak', 'GAINED ACCESS'], lost_access: ['t-leak', 'LOST ACCESS'], still_violating: ['t-leak', 'STILL EXPOSED'],
    access_removed: ['t-pass', 'fixed'], access_restored: ['t-pass', 'restored'], now_unverified: ['t-warn', 'unverified'],
    now_verified: ['t-pass', 'verified'], added: ['dim', 'new check'], removed: ['t-warn', 'dropped'], unchanged: ['dim', 'unchanged'],
  };

  function cellLabel(a) {
    var own = a.expected === 'exact_fixture_returned';
    if (a.status === 'passed') return own ? 'reads own' : 'denied';
    if (a.status === 'failed') return own ? 'owner blocked' : 'DISCLOSED';
    return a.status === 'blocked' ? 'blocked' : 'not assessed';
  }

  function matrix(doc) {
    var paths = doc.paths && doc.paths.length ? doc.paths : [{ id: 'data-api', kind: 'data-api', route: '' }];
    return paths.map(function (p) {
      var as = doc.assertions.filter(function (a) { return (a.path || 'data-api') === p.id; });
      var actors = uniq(as.map(function (a) { return a.actorRef; }));
      var fixtures = uniq(as.map(function (a) { return a.fixtureRef; }));
      var html = '<div class="vf-path"><p class="vf-path__title">' + esc(p.id) + ' <span>' + esc(p.kind) + (p.route ? ' · ' + esc(p.route) : '') + '</span></p>';
      html += '<div class="vf-matrix" style="grid-template-columns:minmax(90px,0.8fr) repeat(' + fixtures.length + ',minmax(0,1fr))"><span></span>' + fixtures.map(function (f) { return '<span class="h">' + esc(f) + '</span>'; }).join('');
      actors.forEach(function (actor) {
        html += '<span class="a">' + esc(actor) + '</span>';
        fixtures.forEach(function (f) {
          var a = as.filter(function (x) { return x.actorRef === actor && x.fixtureRef === f; })[0];
          html += a ? '<span class="vf-cell vf-cell--' + esc(a.status) + '">' + cellLabel(a) + (a.status === 'passed' ? '' : '<small>' + esc(a.diagnostic) + '</small>') + '</span>' : '<span></span>';
        });
      });
      return html + '</div></div>';
    }).join('');
  }

  function card(f) {
    var d = f.doc, V = window.PyxVerify;
    var problems = V.check(d);
    var head = '<section class="vf-card"><h2>' + esc(f.name) + ' <small>sha256 ' + esc(f.hash.slice(0, 16)) + '…</small></h2>';
    if (problems.length) return head + '<div class="vf-err">This is not a readable Pyx result: ' + esc(problems.join('; ')) + '.</div></section>';
    var audit = V.audit(d);
    var o = OUTCOME[d.summary.outcome] || ['pill--blocked', String(d.summary.outcome)];
    var html = head;
    html += '<dl class="kv"><dt>Rule</dt><dd class="mono">' + esc(d.rule.ruleId) + ' · revision ' + esc(d.rule.revision == null ? '-' : d.rule.revision) + '<br>' + esc(d.rule.contentHash || 'no approved hash') + '</dd>';
    html += '<dt>Observed</dt><dd class="mono">' + esc(d.observedAt && d.observedAt.startedAt) + '</dd>';
    html += '<dt>Commit</dt><dd class="mono">' + esc((d.source && d.source.commit) || 'not recorded') + (d.source && d.source.dirty ? ' (uncommitted changes)' : '') + '</dd>';
    html += '<dt>Target</dt><dd class="mono">' + esc(d.target && d.target.origin) + '</dd></dl>';
    html += '<div class="vf-verdict"><span class="pill ' + o[0] + '">' + o[1] + '</span><span>' + d.assertions.length + ' checks: ' + audit.recomputed.counts.passed + ' passed, ' + audit.recomputed.counts.failed + ' failed, ' + audit.recomputed.counts.blocked + ' blocked, ' + audit.recomputed.counts.not_assessed + ' not assessed.</span>';
    html += audit.mismatches.length === 0 ? '<span class="t-pass">The stated verdict matches the checks in the file.</span></div>' : '</div><div class="vf-mismatch"><b>The verdict in this file does not match its own checks.</b> It may have been edited.<ul>' + audit.mismatches.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>';
    var bad = d.controls.filter(function (c) { return c.status !== 'ok'; });
    if (bad.length) html += '<p class="note">Controls not established: ' + bad.map(function (c) { return '<code>' + esc(c.id) + '</code> (' + esc(c.diagnostic) + ')'; }).join(', ') + '. Nothing that depends on them can pass.</p>';
    return html + matrix(d) + '</section>';
  }

  function review(a, b) {
    var V = window.PyxVerify, c;
    try {
      c = V.compareResults(a.doc, b.doc, { before: a.name, after: b.name });
    } catch (e) {
      return '<div class="vf-err">' + esc(e && e.message ? e.message : 'These two results cannot be compared.') + '</div>';
    }
    var shown = c.changes.filter(function (x) { return x.change !== 'unchanged'; });
    var head = c.regressions > 0 ? c.regressions + ' access change' + (c.regressions === 1 ? '' : 's') : c.counts.still_violating > 0 ? 'Still exposed' : shown.length ? 'Changes' : 'No access changes';
    var html = '<section class="vf-card"><h2>' + esc(head) + ' <small>' + esc(a.name) + ' → ' + esc(b.name) + '</small></h2>';
    if (!c.sameRevision) html += '<p class="note">The approved rule differs between these runs. Review the rule change too.</p>';
    if (shown.length) {
      html += '<ul class="vf-review">' + shown.map(function (x) {
        var k = CHANGE[x.change];
        return '<li><b class="' + k[0] + '">' + k[1] + '</b><span>' + esc(V.describeCell(x)) + '</span><span class="route">' + esc(x.path) + '</span></li>';
      }).join('') + '</ul>';
    }
    html += '<p class="note">' + c.counts.unchanged + ' checks unchanged. The CLI gives the same answer: <code>pyx compare ' + esc(a.name) + ' ' + esc(b.name) + '</code> (exit ' + c.exitCode + ').</p>';
    return html + '</section>';
  }

  function show(files) {
    if (!window.PyxVerify) { out.innerHTML = '<div class="vf-err">The verifier failed to load.</div>'; return; }
    files.sort(function (x, y) { return String(x.doc && x.doc.observedAt && x.doc.observedAt.startedAt).localeCompare(String(y.doc && y.doc.observedAt && y.doc.observedAt.startedAt)); });
    var html = '';
    if (files.length === 2 && files.every(function (f) { return window.PyxVerify.check(f.doc).length === 0; })) html += review(files[0], files[1]);
    html += files.map(card).join('');
    out.innerHTML = html;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function load(list) {
    var picked = Array.prototype.slice.call(list, 0, 2);
    if (!picked.length) return;
    Promise.all(picked.map(function (file) {
      if (file.size > MAX) return Promise.reject(new Error(file.name + ' is larger than 2 MB.'));
      return file.text().then(function (text) { return parse(file.name, text); });
    })).then(show, function (e) { out.innerHTML = '<div class="vf-err">' + esc(e.message) + '</div>'; });
  }

  function parse(name, text) {
    var doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error(name + ' is not valid JSON.'); }
    return window.PyxVerify.sha256(text).then(function (hash) { return { name: name, doc: doc, hash: hash }; });
  }

  drop.addEventListener('click', function () { input.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', function () { load(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('vf__drop--over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('vf__drop--over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer) load(e.dataTransfer.files); });

  document.querySelectorAll('[data-sample]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var names = btn.getAttribute('data-sample') === 'two' ? ['release-41-pass.json', 'release-42-fail.json'] : ['release-42-fail.json'];
      Promise.all(names.map(function (n) {
        return fetch('samples/' + n).then(function (r) { if (!r.ok) throw new Error('could not load ' + n); return r.text(); }).then(function (t) { return parse(n, t); });
      })).then(show, function (e) { out.innerHTML = '<div class="vf-err">' + esc(e.message) + '</div>'; });
    });
  });
})();
