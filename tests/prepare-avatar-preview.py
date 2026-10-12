from pathlib import Path
root=Path(__file__).resolve().parents[1]
dev=root/'webgame/dev';dev.mkdir(exist_ok=True)
s=(root/'webgame/index.html').read_text(encoding='utf-8')
s=s.replace('<head>','<head><base href="/">').replace('<script type="module" src="js/profile.js?v=5"></script>','<script type="module" src="dev/avatar-fixture.js"></script>')
s=s.replace('<body>','<body><p id="avatarFixtureStatus" style="position:fixed;left:8px;top:8px;z-index:100;background:white;padding:8px;max-width:300px;font-size:12px">TEST FIXTURE · local face analysis · no upload</p>')
(dev/'avatar-preview.html').write_text(s,encoding='utf-8')
(dev/'avatar-human.jpg').write_bytes((root/'tests/artifacts/profile-human-fixture.jpg').read_bytes())
(dev/'avatar-invalid.jpg').write_bytes((root/'tests/artifacts/profile-upload-fixture.jpg').read_bytes())
(dev/'avatar-fixture.js').write_text('''import {analyzeFacePhoto} from '/js/profile-face.js';
const status=document.getElementById('avatarFixtureStatus');
const blob=await fetch('/dev/'+(location.search.includes('invalid')?'avatar-invalid.jpg':'avatar-human.jpg')).then(r=>r.blob());
try {
const parameters=await analyzeFacePhoto(blob);
window.westonProfile={photo:blob};
window.dispatchEvent(new CustomEvent('profilechange',{detail:window.westonProfile}));
status.textContent='TEST FIXTURE · face detected · 3D geometry · no upload';
status.dataset.result='detected';
}catch(error){status.textContent='TEST FIXTURE · '+error.message;status.dataset.result='rejected';}
''',encoding='utf-8')
