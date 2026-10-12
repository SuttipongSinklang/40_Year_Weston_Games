// Navigation loads independently of the 3D scene so running stays accessible.
const buttons = [...document.querySelectorAll('.nav-btn')];
let running, active = 'home';

/* ── พับ/กางแถบ NAV (ใช้ได้ทุกหน้ายกเว้นหน้าหลัก ซึ่งแสดงเมนูตลอด) ── */
const navWrap = document.getElementById('bottomNavWrap');
const navFoldBtn = document.getElementById('navFoldBtn');
let navFolded = false;
function applyNavFold() {
  const home = active === 'home';
  if (home) navFolded = false;
  navWrap?.classList.toggle('folded', navFolded);
  navWrap?.classList.toggle('home-locked', home);
  document.body.classList.toggle('nav-folded', navFolded);
  if (!navFoldBtn) return;
  navFoldBtn.setAttribute('aria-expanded', String(!navFolded));
  navFoldBtn.setAttribute('aria-label', navFolded ? 'แสดงเมนู' : 'พับเมนู');
}
navFoldBtn?.addEventListener('click', () => {
  navFolded = !navFolded;
  applyNavFold();
});

function showScreen(target) {
  if (!buttons.some(button => button.dataset.screen === target)) target = 'home';
  if (active === 'run' && target !== 'run') running?.leave();
  active = target;
  buttons.forEach(button => {
    const selected = button.dataset.screen === target;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === `screen-${target}`);
  });
  applyNavFold();
  if (target === 'run') running?.enter();
  window.dispatchEvent(new CustomEvent('screenchange', { detail: target }));
}
buttons.forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.screen;
  showScreen(target);
  if (location.hash !== `#${target}`) location.hash = target;
}));
window.addEventListener('hashchange', () => showScreen(location.hash.slice(1)));
showScreen(location.hash.slice(1));
import('./running.js?v=20261012-2').then(async module => {
  running = await module.initializeRunning({ toast(message) {
    const element = document.getElementById('toast');
    if (element) {
      element.textContent = message;
      element.classList.add('show');
      setTimeout(() => element.classList.remove('show'), 3000);
    }
  } });
  if (active === 'run') running.enter();
}).catch(error => {
  console.error('Running initialization failed', error);
  document.getElementById('runMessage').textContent = 'เปิดระบบวิ่งไม่ได้ กรุณาโหลดหน้าใหม่';
});
