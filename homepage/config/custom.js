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