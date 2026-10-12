from pathlib import Path
import json
root = Path(__file__).resolve().parents[1]
p = root / 'webgame/dev'
p.mkdir(exist_ok=True)
s = (root / 'webgame/index.html').read_text(encoding='utf-8')
s = s.replace('<head>', '<head><base href="/">')
start = s.index('{', s.index('<script type="importmap">'))
end = s.index('</script>', start)
mapping = json.loads(s[start:end])
mapping['imports']['/js/profile-cloud.js'] = '/dev/profile-cloud-fixture.js'
s = s[:start] + json.dumps(mapping) + s[end:]
s = s.replace('<body>', '<body><p style="position:fixed;bottom:90px;left:8px;z-index:100;background:white;font-size:11px">TEST FIXTURE · no health/photo upload</p>')
(p / 'profile-test.html').write_text(s, encoding='utf-8')
(p / 'profile-mobile.html').write_text('<!doctype html><html><head><meta charset="utf-8"><title>Mobile profile test</title></head><body style="margin:0;background:#eaf0ef"><p>Mobile test fixtures · no health/photo upload</p><div style="display:flex;gap:16px"><iframe title="390px mobile app" src="profile-test.html?player=mobile390#home" style="width:390px;height:844px;border:0"></iframe><iframe title="320px mobile app" src="profile-test.html?player=mobile320#home" style="width:320px;height:720px;border:0"></iframe></div></body></html>', encoding='utf-8')
(p / 'profile-cloud-fixture.js').write_text('export async function profileSession(){return {userId: "isolated-onboarding-"+(new URLSearchParams(location.search).get("player")||"test")};} export async function fetchCloudProfile(){return null;} export async function saveCloudProfile(){if(new URLSearchParams(location.search).get("save")==="fail")throw new Error("Synthetic offline fixture");return;}', encoding='utf-8')
(root / 'tests/artifacts/profile-face-fixture.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#ffedd0"/><ellipse cx="256" cy="260" rx="174" ry="224" fill="#e9ac7b"/><path d="M82 202 Q74 16 256 26 Q450 26 430 202 Q340 82 170 140Z" fill="#493121"/><circle cx="187" cy="240" r="19" fill="#32291f"/><circle cx="325" cy="240" r="19" fill="#32291f"/><path d="M189 350 Q256 414 327 350" fill="none" stroke="#642f2a" stroke-width="15" stroke-linecap="round"/></svg>''', encoding='utf-8')
