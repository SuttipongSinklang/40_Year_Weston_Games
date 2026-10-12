// Navigation loads independently of the 3D scene so running stays accessible.
const buttons = [...document.querySelectorAll('.nav-btn')];
let running, active = 'home';
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
import('./running.js?v=20261009-13').then(async module => {
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
