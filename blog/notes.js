// Trims each wall note preview to exactly two lines, ending in "… read more".
// Without this script the previews are cut at about 150 characters instead (see generate_feed.py).
(function () {
  var LINES = 2;

  function fit(box) {
    var p = box.querySelector('p');
    var link = box.querySelector('.note-more');
    if (!p || !link) return;
    var words = box.dataset.full.split(' ');
    var max = parseFloat(getComputedStyle(p).lineHeight) * LINES + 2;

    function show(n) {
      var cut = n < words.length;
      var text = words.slice(0, n).join(' ');
      if (cut) text = text.replace(/[\s,;:.\-\u2014]+$/, '') + '\u2026';
      p.textContent = text + ' ';
      p.appendChild(link);
      return p.offsetHeight <= max;
    }

    if (show(words.length)) return;
    // Most words that still fit, with the ellipsis and link, in two lines
    var lo = 1, hi = words.length - 1;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (show(mid)) lo = mid; else hi = mid - 1;
    }
    show(lo);
  }

  function fitAll() {
    document.querySelectorAll('.note-preview[data-full]').forEach(fit);
  }

  var width = 0, timer;
  function onResize() {
    if (window.innerWidth === width) return; // phones fire resize on scroll as the toolbar moves
    width = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(fitAll, 100);
  }

  function start() {
    width = window.innerWidth;
    fitAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
    window.addEventListener('resize', onResize);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
