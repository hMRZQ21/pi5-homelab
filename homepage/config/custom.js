// Daily-rotating background: one picsum.photos (Unsplash-sourced) photo per
// calendar day, seeded by the date so every device shows the same image.
// settings.yaml holds a tiny placeholder that this script swaps for the full image.
(function () {
  var d = new Date();
  var seed = 'homelab-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  var full = 'picsum.photos/seed/' + seed + '/2560/1440';
  function apply() {
    var el = document.getElementById('background');
    if (!el) return;
    var cur = el.style.backgroundImage;
    if (cur.indexOf('picsum.photos/seed/') === -1 || cur.indexOf(full) !== -1) return;
    el.style.backgroundImage = cur.replace(/picsum\.photos\/seed\/[^)'"]+/, full);
  }
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; apply(); });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  apply();
})();

// Container tiles: (1) drop RX/TX, keep CPU and memory; (2) show CPU as a share of the WHOLE Pi.
// Homepage's Docker CPU% is per-core (100% = one core, max 400% here), so divide by the core count.
(function () {
  var CORES = 4; // Raspberry Pi 5
  function fix() {
    var tiles = document.querySelectorAll('li.service');
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      if (!tile.querySelector('.service-container-stats')) continue; // Docker tiles only
      var blocks = tile.querySelectorAll('.service-stats .service-block');
      for (var j = 0; j < blocks.length; j++) {
        var b = blocks[j], kids = b.children;
        if (kids.length < 2) continue;
        var label = kids[1].textContent.trim().toUpperCase();
        if (label === 'RX' || label === 'TX') { b.style.display = 'none'; continue; }
        if (label === 'CPU') {
          var v = kids[0], txt = v.textContent.trim();
          if (v.getAttribute('data-hp-norm') === txt) continue; // already converted
          var m = /^([\d.]+)%$/.exec(txt);
          if (!m) continue;
          var n = parseFloat(m[1]) / CORES;
          var out = (n < 10 ? n.toFixed(1) : String(Math.round(n))) + '%';
          v.textContent = out;
          v.setAttribute('data-hp-norm', out);
          b.title = '% of the whole Pi (' + CORES + ' cores)';
        }
      }
    }
  }
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; fix(); });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  fix();
})();
// Header CPU, RAM and disk, Task Manager style: "37% · 2.4 GHz", "2.5/7.9GB (32%)", "139GB/1.8TB (8%)" (binary units, as Windows shows them).
// Numbers come from Glances through Homepage's own proxy (the LAN Traffic tile's glances widget),
// so Glances stays bound to loopback. Clock = live cpufreq (1.5-2.4 GHz in 0.1 GHz steps on a stock Pi 5, so one decimal is exact).
(function () {
  var BASE = '/api/services/proxy?group=System&service=LAN%20Traffic&index=0&endpoint=4%2F';
  var GIB = 1073741824;
  var TIB = GIB * 1024;
  var cpuTxt = null, ramTxt = null, diskTxt = null;
  function get(ep) {
    return fetch(BASE + ep, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function setVal(n, txt) {
    if (!txt) return;
    // The resources widget's container carries no type class; Glances' does, so take the stats outside it.
    var all = Array.prototype.filter.call(document.querySelectorAll('.information-widget-resource'),
      function (e) { return !e.closest('.information-widget-glances'); });
    var el = all[n - 1] && all[n - 1].querySelector('.pl-0\\.5');
    if (el && el.textContent !== txt) el.textContent = txt;
  }
  function apply() { setVal(1, cpuTxt); setVal(2, ramTxt); setVal(3, diskTxt); }
  function poll() {
    Promise.all([get('quicklook'), get('mem'), get('fs')]).then(function (res) {
      var q = res[0], m = res[1], f = res[2];
      cpuTxt = (q && typeof q.cpu === 'number' && q.cpu_hz_current)
        ? Math.round(q.cpu) + '% · ' + (q.cpu_hz_current / 1e9).toFixed(1) + ' GHz' : null;
      ramTxt = (m && m.total)
        ? (m.used / GIB).toFixed(1) + '/' + (m.total / GIB).toFixed(1) + 'GB (' + Math.round(m.percent) + '%)' : null;
      // Glances runs in a container, so it sees the root SSD through its bind-mounted files; take the largest filesystem.
      var d = Array.isArray(f) && f.length ? f.reduce(function (a, b) { return b.size > a.size ? b : a; }) : null;
      diskTxt = (d && d.size)
        ? (d.used < TIB ? Math.round(d.used / GIB) + 'GB' : (d.used / TIB).toFixed(1) + 'TB') + '/' + (d.size / TIB).toFixed(1) + 'TB (' + Math.round(d.used / d.size * 100) + '%)' : null;
      apply();
    });
  }
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; apply(); });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  poll();
  setInterval(poll, 3000);
})();
