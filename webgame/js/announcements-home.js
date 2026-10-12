// Announcements from the admin site (#20) plus upcoming-match reminders (#8).
// Shows a dismissible banner on the home screen and a toast for the latest news.
import { playerSession } from './data.js?v=20261012-2';
import { myUpcomingMatches } from './tournament-cloud.js?v=20261012-2';

const el = id => document.getElementById(id);

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function toast(message) {
  const element = el('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3000);
}

function ensureBanner() {
  let banner = document.getElementById('announcementBanner');
  if (banner) return banner;
  banner = document.createElement('div');
  banner.id = 'announcementBanner';
  banner.className = 'announce-banner';
  const home = el('screen-home');
  home?.appendChild(banner);
  if (!document.getElementById('announceStyles')) {
    const style = document.createElement('style');
    style.id = 'announceStyles';
    style.textContent = `
.announce-banner{position:absolute;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top));z-index:5;display:flex;gap:10px;align-items:flex-start;background:var(--navy);color:#fff;border-radius:14px;padding:10px 12px;font-size:12.5px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.announce-banner[hidden]{display:none}
.announce-banner .msg{flex:1;min-width:0}
.announce-banner .x{border:none;background:none;color:#9FB6CE;font-size:16px;cursor:pointer;min-width:30px;min-height:30px}`;
    document.head.appendChild(style);
  }
  return banner;
}

function showBanner(message) {
  const banner = ensureBanner();
  banner.innerHTML = `<span class="msg">📣 ${escapeHtml(message)}</span><button type="button" class="x" aria-label="ปิดประกาศ">×</button>`;
  banner.hidden = false;
  banner.querySelector('.x').addEventListener('click', () => { banner.hidden = true; });
}

async function loadAnnouncements() {
  if (!navigator.onLine) return;
  try {
    const api = await playerSession();
    const { data, error } = await api.from('weston_announcements')
      .select('id,message,created_at').order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    const latest = data[0];
    if (latest) {
      const seenId = localStorage.getItem('weston-announcement-seen');
      showBanner(latest.message);
      if (seenId !== latest.id) {
        toast('มีประกาศใหม่จากผู้ดูแล 📣');
        localStorage.setItem('weston-announcement-seen', latest.id);
      }
    }
  } catch { /* announcements are optional */ }
}

async function loadUpcomingMatch() {
  if (!navigator.onLine) return;
  try {
    const api = await playerSession();
    const { rows } = await myUpcomingMatches(api.userId);
    const next = rows[0];
    if (!next) return;
    const minutes = Math.round((new Date(next.scheduled_at) - Date.now()) / 60000);
    if (minutes < 0 || minutes > 240) return;
    toast(minutes <= 60
      ? `ถึงคิวแข่งของคุณในอีก ${minutes} นาที! (${next.round_label}) ⏰`
      : `แมตช์ถัดไปของคุณในอีก ${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที (${next.round_label})`);
  } catch { /* reminders are optional */ }
}

void loadAnnouncements();
setTimeout(() => { void loadUpcomingMatch(); }, 4000);
