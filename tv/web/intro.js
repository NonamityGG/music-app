// Резонанс OS: the start. A point of light, a ring of sound running out of it,
// the four bars of the logo rising, the name — then the home screen gathers
// itself from the top. About two and a half seconds; any key skips it.

const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
const BACK = 'cubic-bezier(0.34, 1.5, 0.64, 1)';

export function play(done) {
  const box = document.getElementById('intro');
  const body = document.body;
  if (!box.animate) {
    body.classList.remove('intro-on');
    done();
    return () => {};
  }
  box.innerHTML = `<div class="i-c"><i class="i-ring"></i><i class="i-dot"></i>
    <div class="i-lock"><span class="i-mark"><i></i><i></i><i></i><i></i></span><b class="i-word">Резонанс</b><span class="i-os">OS</span></div></div>`;
  const lock = box.querySelector('.i-lock');
  const dot = box.querySelector('.i-dot');
  const ring = box.querySelector('.i-ring');
  const bars = box.querySelectorAll('.i-mark i');
  const word = box.querySelector('.i-word');
  const os = box.querySelector('.i-os');
  // the lockup is centred by its own width
  lock.style.left = `${-lock.offsetWidth / 2}px`;
  const markX = bars[0].getBoundingClientRect().left - dot.getBoundingClientRect().left;
  const anims = [];
  const a = (elx, frames, opts) => {
    const an = elx.animate(frames, { fill: 'both', easing: EASE, ...opts });
    anims.push(an);
    return an;
  };

  // 0: the point lights up in the middle
  a(dot, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420 });
  // 0.35: a ring of sound runs out of it
  a(ring, [{ opacity: 0.9, transform: 'scale(0.05)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 1100, delay: 320 });
  // 0.5: the point slides to where the logo starts and turns into the bars
  a(dot, [{ transform: 'translateX(0) scale(1)', opacity: 1 }, { transform: `translateX(${markX}px) scale(0.6)`, opacity: 0 }], { duration: 420, delay: 480 });
  const H = [0.42, 1, 0.66, 0.32];
  bars.forEach((b, i) => a(b, [{ transform: 'scaleY(0)' }, { transform: `scaleY(${H[i] * 1.25})` }, { transform: `scaleY(${H[i]})` }], { duration: 620, delay: 620 + i * 70, easing: BACK }));
  // 0.85: the name arrives out of a blur
  a(word, [{ opacity: 0, transform: 'translateX(-3rem)', filter: 'blur(1.2rem)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 700, delay: 860 });
  a(os, [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 560, delay: 1240, easing: BACK });
  // 1.9: the lockup steps back and the home screen comes
  const out = a(box, [{ opacity: 1 }, { opacity: 0 }], { duration: 600, delay: 2050 });
  a(lock, [{ transform: 'scale(1)' }, { transform: 'scale(0.92)' }], { duration: 900, delay: 1800 });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    body.classList.remove('intro-on');
    gather();
    box.innerHTML = '';
    done();
  };
  out.onfinish = finish;
  setTimeout(() => body.classList.remove('intro-on'), 2050);
  // skip
  return () => {
    for (const an of anims) an.finish();
    finish();
  };
}

// the home screen's parts come in one after another
function gather() {
  const parts = document.querySelectorAll('#home .top, #home .hero, #home .np, #home .row');
  Array.prototype.forEach.call(parts, (p, i) => {
    if (!p.animate) return;
    p.animate([{ opacity: 0, transform: 'translateY(3rem)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 60 + i * 70, easing: EASE, fill: 'backwards' });
  });
}
