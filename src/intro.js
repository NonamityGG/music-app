// Launch intro: a plucked string rings, its vibration turns into the bars of the
// Резонанс mark, the tile forms around them, the name appears — and then the
// app comes forward through it.
//
// Runs inline in index.html (tools/build.mjs puts it there), so it is drawn with
// the very first frame, and only then loads app.js. While the app starts up
// underneath, only a point of light breathes in the middle (the same point the
// Android splash showed): a phone is busiest in those first seconds and any
// real motion would stutter. When the app is built (rezIntro.ready()) and the
// frames come evenly again, the string is plucked and the whole piece plays —
// transform/opacity only, on the GPU. A tap skips ahead.

(function () {
  var BARS = [0.36, 0.68, 1.0, 0.56, 0.82, 0.44]; // the icon's waveform
  var NAME = 'Резонанс';

  var saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('rez.settings') || '{}') || {};
  } catch (e) {}

  var api = (window.rezIntro = { active: false, ready: function () {}, play: play });

  // tells Android the page is on screen, so its splash can hand over without a gap
  function shown() {
    try {
      var C = window.Capacitor;
      if (C && C.isNativePlatform && C.isNativePlatform() && C.nativePromise) C.nativePromise('Screen', 'shown', {}).catch(function () {});
    } catch (e) {}
  }

  function loadApp() {
    if (document.getElementById('rez-app')) return;
    var s = document.createElement('script');
    s.id = 'rez-app';
    s.src = 'app.js';
    document.body.appendChild(s);
  }

  // ---------- helpers ----------

  function el(cls, parent, css) {
    var n = document.createElement(cls === 'i' ? 'i' : 'div');
    if (cls !== 'i') n.className = cls;
    if (css) for (var k in css) n.style[k] = typeof css[k] === 'number' ? css[k] + 'px' : css[k];
    if (parent) parent.appendChild(n);
    return n;
  }
  var clamp = function (v, a, b) {
    return v < a ? a : v > b ? b : v;
  };
  var smooth = function (a, b, t) {
    var x = clamp((t - a) / (b - a), 0, 1);
    return x * x * (3 - 2 * x);
  };
  var inOut = function (x) {
    x = clamp(x, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  var outCubic = function (x) {
    x = clamp(x, 0, 1);
    return 1 - Math.pow(1 - x, 3);
  };
  // a damped spring from 0 to 1: overshoots, rings down, settles
  var spring = function (s, period, damp) {
    if (s <= 0) return 0;
    var w = (2 * Math.PI) / period;
    return 1 - Math.exp(-damp * s) * (Math.cos(w * s) + (damp / w) * Math.sin(w * s));
  };
  var hash = function (i) {
    var x = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
    return x - Math.floor(x);
  };
  var r2 = function (v) {
    return Math.round(v * 100) / 100;
  };

  // ---------- the intro ----------

  function play(first) {
    if (api.active) return;
    api.active = true;
    try {
      window.dispatchEvent(new Event('rez-intro-in'));
    } catch (e) {}
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    var vw = window.innerWidth || 360;
    var vh = window.innerHeight || 640;
    var m = Math.min(vw, vh);
    var T = Math.round(clamp(m * 0.3, 96, 136)); // tile
    var R = Math.round(T * 0.235); // its corner
    var G = T * 0.5; // the waveform inside it
    // bar width and its left edge on whole screen pixels: the two halves of a
    // bar are separate layers and must line up exactly
    var dpr = window.devicePixelRatio || 1;
    var Wd = Math.max(4, Math.round((G / (6 + 5 * 0.55)) * dpr));
    var W = Wd / dpr; // bar width
    var LEFT = -Math.round(Wd / 2) / dpr;
    var GAP = W * 0.55;
    var F = Math.round(clamp(T * 0.23, 22, 30)); // name size
    var WORD_GAP = Math.round(T * 0.27);
    var D = (WORD_GAP + F * 1.1) / 2; // the lockup moves up by this to sit centred
    var L = Math.min(vw * 0.8, 440); // string length
    var N = 21; // points on the string
    var A = Math.min(vh * 0.055, 44); // string swing
    var HB = G + W + 4; // room for half of the tallest bar

    var root = el('', null);
    root.id = 'intro';
    root.setAttribute('aria-hidden', 'true');
    var sky = el('i-sky', root);
    var lock = el('i-lock', root);
    var move = el('i-move', lock);

    var anims = [];
    var go = function (node, frames, opts) {
      opts.fill = opts.fill || 'both';
      var a = node.animate(frames, opts);
      anims.push(a);
      return a;
    };

    // --- coloured light in the sky ---
    var S = Math.max(vw, vh) * 1.05;
    var blobs = [
      [124, 77, 255, 0.5, -0.22 * vw, -0.17 * vh, 7.2],
      [255, 79, 180, 0.34, 0.26 * vw, 0.05 * vh, 6.1],
      [47, 107, 255, 0.4, -0.05 * vw, 0.25 * vh, 8.3],
    ];
    blobs.forEach(function (b, i) {
      var c = b[0] + ',' + b[1] + ',' + b[2];
      // a soft cloud needs no detail: drawn on a tiny canvas and stretched,
      // instead of a screen-sized gradient for the GPU to paint and hold
      var n = document.createElement('canvas');
      n.className = 'i-blob';
      n.width = n.height = 128;
      var st = { width: S, height: S, left: b[4] - S / 2, top: b[5] - S / 2 };
      for (var key in st) n.style[key] = st[key] + 'px';
      sky.appendChild(n);
      try {
        var cx = n.getContext('2d');
        var gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, 'rgba(' + c + ',' + b[3] + ')');
        gr.addColorStop(0.5, 'rgba(' + c + ',' + b[3] * 0.35 + ')');
        gr.addColorStop(1, 'rgba(' + c + ',0)');
        cx.fillStyle = gr;
        cx.fillRect(0, 0, 128, 128);
      } catch (e) {}
      if (reduce) return;
      go(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 1300, delay: 200 + i * 140, easing: 'ease-out' });
      var dx = (i % 2 ? -1 : 1) * vw * 0.06;
      var dy = (i === 1 ? -1 : 1) * vh * 0.04;
      go(n, [{ transform: 'translate(0,0) scale(1)' }, { transform: 'translate(' + r2(dx) + 'px,' + r2(dy) + 'px) scale(1.14)' }], {
        duration: b[6] * 1000,
        direction: 'alternate',
        iterations: Infinity,
        easing: 'ease-in-out',
        fill: 'none',
      });
    });

    // --- halo behind it all ---
    var GW = Math.max(L, T * 2.2) * 1.1;
    var GH = T * 1.9;
    var glow = el('i-glow', move, { width: GW, height: GH, left: -GW / 2, top: -GH / 2 });

    // --- resonance rings ---
    var rings = [0, 1].map(function () {
      return el('i-ring', move, { width: T, height: T, left: -T / 2, top: -T / 2, borderRadius: R, opacity: '0' });
    });

    // --- the string ---
    var line = el('i-line', move, { width: L, left: -L / 2, top: -1 });
    var lineGlow = el('i-line-glow', move, { width: L * 1.1, height: 30, left: -L * 0.55, top: -15 });

    // --- the tile ---
    var tile = el('i-tile', move, { width: T, height: T, left: -T / 2, top: -T / 2, borderRadius: R });
    var sheen = el('i-sheen', tile, { width: T * 0.55, left: 0 });

    // --- bars ---
    // A bar is two long pills: the top one shows its round top end, the bottom one
    // its round bottom end, each cut off just past the middle. Moving them apart
    // makes the bar taller. Only moves, never stretches: the ends stay perfectly
    // round at any height and the GPU never has to resample them.
    var iconX = BARS.map(function (_, k) {
      return -G / 2 + W / 2 + k * (W + GAP);
    });
    var iconH = BARS.map(function (f) {
      return Math.max(W, G * f);
    });
    var FIRST = Math.floor(N / 2) - 3; // the six middle points become the mark
    var bars = [];
    for (var i = 0; i < N; i++) {
      var b = el('i-bar', move);
      var clip1 = el('i-clip', b, { left: LEFT - 2, width: W + 4, top: -HB, height: HB + 1 });
      var clip2 = el('i-clip', b, { left: LEFT - 2, width: W + 4, top: -1, height: HB + 1 });
      var pill = { width: W, height: HB + 2, left: 2, borderRadius: W / 2 };
      pill.top = HB - W / 2; // its top end where a dot's top is
      var p1 = el('i', clip1, pill);
      pill.top = W / 2 - (HB + 2) + 1; // its bottom end where a dot's bottom is
      var p2 = el('i', clip2, pill);
      var k = i - FIRST;
      bars.push({ b: b, p1: p1, p2: p2, k: k >= 0 && k < 6 ? k : -1, u: (i + 0.5) / N, x0: -L / 2 + (L * (i + 0.5)) / N });
    }

    // --- the name ---
    var word = el('i-word', move, { top: T / 2 + WORD_GAP, fontSize: F });
    var letters = NAME.split('').map(function (ch) {
      var s = document.createElement('span');
      s.textContent = ch;
      word.appendChild(s);
      return s;
    });

    document.body.appendChild(root);
    if (first) shown();

    var HOLD = reduce ? 650 : 2050; // how long the piece plays (ms)
    var P = Math.min(1, 44 / L); // the waiting point of light: 44px of the string
    var waiting = [];
    if (reduce) {
      // no motion: the finished mark, shown and later faded
      line.style.display = lineGlow.style.display = sheen.style.display = 'none';
      move.style.transform = 'translateY(' + -D + 'px)';
      glow.style.transform = 'scale(0.55, 1)';
      glow.style.opacity = '0.6';
      bars.forEach(function (o) {
        if (o.k < 0) return (o.b.style.display = 'none');
        pose(o, iconX[o.k], 0, iconH[o.k], 1, 1);
      });
      go(lock, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    } else {
      // breathing until the app is ready and the phone has calmed down; the rest
      // stays out of sight until its own animations take over
      [glow, tile].concat(letters, bars.map(function (o) {
        return o.b;
      })).forEach(function (n) {
        n.style.opacity = '0';
      });
      line.style.transform = 'scaleX(' + P + ')';
      lineGlow.style.opacity = '0';
      var breath = { duration: 1100, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' };
      waiting.push(line.animate([{ transform: 'scaleX(' + P + ')', opacity: 1 }, { transform: 'scaleX(' + r2(P * 1.4) + ')', opacity: 0.7 }], breath));
      waiting.push(lineGlow.animate([{ transform: 'scaleX(' + r2(P * 1.1) + ')', opacity: 0.2 }, { transform: 'scaleX(' + r2(P * 1.7) + ')', opacity: 0.85 }], breath));
    }

    function pose(o, x, y, h, sc, op) {
      o.b.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + sc + ')';
      o.b.style.opacity = op;
      o.p1.style.transform = 'translateY(' + -(h - W) / 2 + 'px)';
      o.p2.style.transform = 'translateY(' + (h - W) / 2 + 'px)';
    }

    function choreograph() {
      var ms = function (s) {
        return Math.round(s * 1000);
      };

      // the string draws itself out from the middle, then hands over to its points
      go(line, [{ transform: 'scaleX(' + P + ')' }, { transform: 'scaleX(1)' }], { duration: 400, delay: 30, easing: 'cubic-bezier(.3,.6,.2,1)' });
      go(line, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, delay: ms(0.5), easing: 'linear' });
      go(lineGlow, [{ transform: 'scaleX(' + P + ')', opacity: 0.5 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.45 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.7 }, { transform: 'scaleX(1.1)', opacity: 0 }], {
        duration: 720,
        delay: 30,
        easing: 'ease-out',
      });

      // halo: a wide flat glow under the string that gathers into a round one behind the tile
      go(
        glow,
        [
          { transform: 'scale(1, 0.4)', opacity: 0 },
          { transform: 'scale(1, 0.55)', opacity: 0.9, offset: 0.2 },
          { transform: 'scale(0.75, 0.9)', opacity: 0.8, offset: 0.55 },
          { transform: 'scale(0.55, 1)', opacity: 0.6 },
        ],
        { duration: 1100, delay: 440, easing: 'ease-in-out' }
      );

      // the points: plucked, ringing, rising into bars, gathering into the mark
      var T0 = 0.4;
      var T1 = 1.8;
      var STEP = 1 / 60;
      var f = 2.6; // the string's note, slowed right down
      bars.forEach(function (o) {
        var u = o.u;
        var d = Math.abs(u - 0.5) * 2; // 0 in the middle, 1 at the ends
        var tRise = 0.8 + 0.11 * d;
        var icon = o.k >= 0;
        var xf = icon ? iconX[o.k] : o.x0 * 0.62; // the whole waveform closes up like an accordion
        var hf = icon ? iconH[o.k] : W;
        var bump = W + G * (0.55 + 0.45 * hash(o.u * 100)) * Math.pow(Math.sin(Math.PI * u), 0.7);
        var fb = [];
        var f1 = [];
        var f2 = [];
        var n = Math.round((T1 - T0) / STEP);
        for (var j = 0; j <= n; j++) {
          var t = T0 + (j / n) * (T1 - T0);
          var off = j / n;
          // swing of the string
          var y = 0;
          var tau = t - 0.5;
          if (tau > 0 && tau < 0.62) {
            var rise = 1 - Math.exp(-tau / 0.035);
            var fade = tau < 0.3 ? 1 : Math.pow(Math.cos((Math.min(1, (tau - 0.3) / 0.32) * Math.PI) / 2), 2);
            y =
              A *
              rise *
              fade *
              (Math.sin(Math.PI * u) * Math.cos(2 * Math.PI * f * tau) +
                0.38 * Math.sin(2 * Math.PI * u) * Math.cos(2 * Math.PI * 2.03 * f * tau + 0.5) * Math.exp(-tau / 0.22) +
                0.2 * Math.sin(3 * Math.PI * u) * Math.cos(2 * Math.PI * 3.1 * f * tau + 1.2) * Math.exp(-tau / 0.15));
          }
          // gathering in
          var x = o.x0 + (xf - o.x0) * inOut((t - 0.86) / 0.42);
          // height
          var s = t - tRise;
          var h = W;
          var sc = 0.3 + 0.7 * outCubic((t - 0.44) / 0.12);
          var op = smooth(0.44, 0.54, t);
          if (icon) h = W + (hf - W) * spring(s, 0.25, 9);
          else if (s > 0) {
            h = W + (bump - W) * Math.sin(Math.PI * clamp(s / 0.4, 0, 1));
            var gone = smooth(0.06, 0.34, s);
            op *= 1 - gone;
            sc *= 1 - 0.6 * gone;
          }
          if (j === n) {
            x = xf;
            y = 0;
            h = hf;
            if (icon) sc = op = 1;
          }
          var ext = Math.max(0, h - W);
          fb.push({ offset: off, transform: 'translate(' + r2(x) + 'px,' + r2(y) + 'px) scale(' + r2(sc) + ')', opacity: r2(op) });
          f1.push({ offset: off, transform: 'translateY(' + r2(-ext / 2) + 'px)' });
          f2.push({ offset: off, transform: 'translateY(' + r2(ext / 2) + 'px)' });
        }
        var opt = { duration: ms(T1 - T0), delay: ms(T0), easing: 'linear' };
        go(o.b, fb, opt);
        go(o.p1, f1, opt);
        go(o.p2, f2, opt);
        if (!icon) setTimeout(function () {
          o.b.style.visibility = 'hidden';
        }, ms(T1) + 50);
      });

      // the tile grows out from behind the bars as they gather
      var tf = [];
      for (var j = 0; j <= 48; j++) {
        var s = (j / 48) * 0.8;
        tf.push({ offset: j / 48, transform: 'scale(' + (0.5 + 0.5 * spring(s, 0.36, 8)).toFixed(4) + ')', opacity: r2(smooth(0, 0.14, s)) });
      }
      tf[48].transform = 'scale(1)';
      go(tile, tf, { duration: 800, delay: 900, easing: 'linear' });
      go(sheen, [{ transform: 'translateX(' + -T * 0.7 + 'px) rotate(18deg)' }, { transform: 'translateX(' + T * 1.25 + 'px) rotate(18deg)' }], {
        duration: 650,
        delay: 1320,
        easing: 'cubic-bezier(.45,0,.25,1)',
      });

      // the lockup rises to make room for the name
      go(move, [{ transform: 'translateY(0)' }, { transform: 'translateY(' + r2(-D) + 'px)' }], { duration: 600, delay: 1080, easing: 'cubic-bezier(.45,0,.2,1)' });

      // two rings go out as the mark settles
      rings.forEach(function (ring, i) {
        go(
          ring,
          [
            { transform: 'scale(1)', opacity: 0 },
            { transform: 'scale(1.12)', opacity: 0.75, offset: 0.08 },
            { transform: 'scale(' + (2.5 + i * 0.5) + ')', opacity: 0 },
          ],
          { duration: 900, delay: 1160 + i * 170, easing: 'cubic-bezier(.15,.6,.3,1)' }
        );
      });

      // the name: letters rise and close in, one after another
      letters.forEach(function (sp, i) {
        var dx = (i - (letters.length - 1) / 2) * F * 0.2;
        go(sp, [{ opacity: 0, transform: 'translate(' + r2(dx) + 'px,' + Math.round(F * 0.55) + 'px)' }, { opacity: 1, transform: 'translate(0,0)' }], {
          duration: 600,
          delay: 1200 + i * 35,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      });
    }

    // ---------- leaving ----------

    var appReady = !first;
    var readyAt = appReady ? now() : 0;
    var timeUp = false;
    var leaving = false;
    var playing = false;
    api.ready = function () {
      if (appReady) return;
      appReady = true;
      readyAt = now();
      leave(false);
    };
    var safety = setTimeout(function () {
      appReady = timeUp = true;
      leave(false);
    }, 9000);
    root.addEventListener('pointerdown', function () {
      timeUp = true;
      leave(true);
    });

    // start the piece once the app is built and 8 frames in a row came on time
    // (or 1.5 s after the app was ready, whatever the frames do)
    if (reduce) startClock();
    else {
      var last = 0;
      var even = 0;
      var frame = function (t) {
        if (leaving || playing) return;
        if (last) even = t - last < 24 ? even + 1 : 0;
        last = t;
        if (appReady && (even >= 8 || now() - readyAt > 1500)) {
          playing = true;
          waiting.forEach(function (a) {
            a.cancel();
          });
          line.style.opacity = '';
          lineGlow.style.opacity = '';
          choreograph();
          startClock();
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }
    function startClock() {
      setTimeout(function () {
        timeUp = true;
        leave(false);
      }, HOLD);
    }
    function now() {
      return window.performance && performance.now ? performance.now() : Date.now();
    }

    function leave(fast) {
      if (leaving || !appReady || !timeUp) return;
      leaving = true;
      clearTimeout(safety);
      var k = fast ? 0.6 : 1;
      try {
        window.dispatchEvent(new CustomEvent('rez-intro-out', { detail: { fast: !!fast, reduce: !!reduce } }));
      } catch (e) {}
      if (reduce) {
        go(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-out' }).onfinish = done;
        return;
      }
      // the mark comes towards you and dissolves, the light opens out, the app is behind it
      go(lock, [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }], { duration: 520 * k, easing: 'cubic-bezier(.5,0,.75,.35)' });
      go(lock, [{ opacity: 1 }, { opacity: 0 }], { duration: 320 * k, easing: 'cubic-bezier(.4,0,.6,1)' });
      go(sky, [{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }], { duration: 700 * k, easing: 'cubic-bezier(.2,.7,.3,1)' });
      go(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 560 * k, delay: 90 * k, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = done;
    }

    function done() {
      waiting.concat(anims).forEach(function (a) {
        try {
          a.cancel();
        } catch (e) {}
      });
      anims = [];
      waiting = [];
      if (root.parentNode) root.parentNode.removeChild(root);
      api.active = false;
      api.ready = function () {};
      try {
        window.dispatchEvent(new Event('rez-intro-done'));
      } catch (e) {}
    }
  }

  // ---------- start ----------

  if (saved.intro === false || !Element.prototype.animate) {
    shown();
    loadApp();
    return;
  }
  // the fonts are local, this only makes sure the name doesn't wait for them
  try {
    document.fonts.load('700 28px Unbounded', NAME);
  } catch (e) {}
  try {
    play(true);
  } catch (e) {
    // whatever went wrong, the app itself must still start
    var r = document.getElementById('intro');
    if (r) r.parentNode.removeChild(r);
    api.active = false;
    shown();
    loadApp();
    return;
  }
  // let the first frames reach the screen, then start the app underneath
  requestAnimationFrame(function () {
    requestAnimationFrame(loadApp);
  });
  setTimeout(loadApp, 400); // in case frames are held back (hidden WebView)
})();
