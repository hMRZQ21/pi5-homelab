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
