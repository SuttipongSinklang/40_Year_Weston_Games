// Explicitly labelled sample team/social data; never persisted as real player data.
const teams = [
  { name: 'ทีมสิงโตป่า', ava: '🦁', score: 4800 },
  { name: 'ทีมนกอินทรี', ava: '🦅', score: 4400 },
  { name: 'ทีมเสือโคร่ง', ava: '🐯', score: 4100 },
  { name: 'ทีมหมีขั้วโลก', ava: '🐻‍❄️', score: 3600 },
  { name: 'ทีมกบนักกระโดด', ava: '🐸', score: 3000 },
];
const maxTeam = teams[0].score;
document.getElementById('lbTeam').insertAdjacentHTML('beforeend', teams.map((t, i) => `
  <div class="lb-row">
    <div class="lb-rank">
      <span class="rank-badge ${i < 3 ? 'rank-' + (i + 1) : ''}">
        ${i < 3 ? '<span class="crown">👑</span>' : ''}${i + 1}
      </span>
    </div>
    <div class="lb-player">
      <span class="lb-ava">${t.ava}</span>
      <span class="lb-name">${t.name}</span>
    </div>
    <div class="lb-score">
      <div class="lb-scorebar"><i style="width:${Math.round(t.score / maxTeam * 100)}%"></i></div>
      <div class="lb-flame"><span>🔥</span>${t.score.toLocaleString()}</div>
    </div>
  </div>`).join(''));

document.querySelectorAll('.pill').forEach(pill => pill.addEventListener('click', () => {
  document.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p === pill));
  document.querySelectorAll('.pill').forEach(p => p.setAttribute('aria-pressed', String(p === pill)));
  document.getElementById('lbPerson').classList.toggle('hidden', pill.dataset.lb !== 'person');
  document.getElementById('lbTeam').classList.toggle('hidden', pill.dataset.lb !== 'team');
}));


const friends = [
  { ava: '😎', name: 'Player 2', on: true },
  { ava: '🦊', name: 'Player 3', on: true },
  { ava: '🐼', name: 'Player 4', on: false },
  { ava: '🦁', name: 'Player 1', on: true },
  { ava: '🐯', name: 'Player 5', on: false },
];
document.getElementById('friendsRow').insertAdjacentHTML('beforeend',
  `<div class="friend add"><span class="friend-ava">＋</span><small>เพิ่มเพื่อน</small></div>` +
  friends.map(f => `
    <div class="friend">
      <span class="friend-ava">${f.ava}<i class="${f.on ? 'on' : ''}"></i></span>
      <small>${f.name}</small>
    </div>`).join(''));

const feeds = [
  { ava: '😎', name: 'Player 2', text: 'ออกกำลังกายเสร็จแล้ว! <b>ได้รับ 120 XP</b> 💪', likes: 12, mins: 5 },
  { ava: '🦊', name: 'Player 3', text: 'ขึ้นอันดับเป็น <b>อันดับ 3</b> ของลีกแล้ว 🎉', likes: 8, mins: 24 },
  { ava: '🦁', name: 'Player 1', text: 'ต่อเนื่อง <b>56 วัน</b> ไฟไม่ดับ! 🔥', likes: 21, mins: 60 },
];
document.getElementById('feed').innerHTML = feeds.map(f => `
  <div class="feed-item card">
    <span class="lb-ava">${f.ava}</span>
    <div>
      <h4><b>${f.name}</b> ${f.text}</h4>
      <div class="feed-meta">
        <button class="like-btn">❤️ <span>${f.likes}</span></button>
        <span>🖱️ แสดงความยินดี</span>
        <span>${f.mins} นาทีที่แล้ว</span>
      </div>
    </div>
  </div>`).join('');

document.querySelectorAll('.like-btn').forEach(btn => btn.addEventListener('click', () => {
  const n = btn.querySelector('span');
  const liked = btn.classList.toggle('liked');
  n.textContent = +n.textContent + (liked ? 1 : -1);
  btn.setAttribute('aria-pressed', String(liked));
  if (liked) n.previousSibling.textContent = '💖 ';
  else n.previousSibling.textContent = '❤️ ';
}));
