"""Run native APK instrumentation with synthetic emulator GPS; never uploads fixture runs."""
from pathlib import Path
import argparse,subprocess,threading,time
parser=argparse.ArgumentParser()
parser.add_argument('--sdk-root',required=True)
parser.add_argument('--serial',default='emulator-5554')
args=parser.parse_args()
if not args.serial.startswith('emulator-'):raise SystemExit('Only a disposable Android emulator is supported.')
root=Path(__file__).resolve().parents[2]
adb=Path(args.sdk_root)/'platform-tools/adb.exe'
artifacts=root/'tests/artifacts/android-emulator'
artifacts.mkdir(parents=True,exist_ok=True)
def run(*cmd,check=True):
 return subprocess.run([str(adb),'-s',args.serial,*cmd],capture_output=True,text=True,encoding='utf-8',errors='replace',check=check,timeout=40)
if run('emu','avd','name').stdout.splitlines()[0].strip()!='Weston_Test_API35':
 raise SystemExit('Use only the dedicated Weston_Test_API35 fixture emulator.')
app=root/'webgame/downloads/weston-fit-quest-1.0.2.apk'
test=root/'mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
for apk in [app,test]:print(run('install','-r',str(apk)).stdout.strip(),flush=True)
# This dedicated emulator holds only synthetic fixtures; reset them before a repeat.
run('shell','pm','clear','com.weston.fitquest')
for permission in ['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','POST_NOTIFICATIONS','ACTIVITY_RECOGNITION']:
 run('shell','pm','grant','com.weston.fitquest','android.permission.'+permission)
run('logcat','-c')
stop=threading.Event()
def gps():
 step=0
 while not stop.is_set():
  result=run('emu','geo','fix','100.5018',str(13.7563+step*.00010),check=False)
  if result.returncode:print('GPS error:',result.stderr,flush=True)
  step+=1;stop.wait(3)
thread=threading.Thread(target=gps,daemon=True);thread.start()
try:
 process=subprocess.Popen([str(adb),'-s',args.serial,'shell','am','instrument','-w','-e','class',
  'com.weston.running.RunningEmulatorTest','com.weston.fitquest.test/androidx.test.runner.AndroidJUnitRunner'],
  stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace')
 with (artifacts/'instrumentation.txt').open('w',encoding='utf-8') as log:
  for line in process.stdout:
   print(line,end='',flush=True);log.write(line);log.flush()
 code=process.wait()
finally:
 stop.set();thread.join(timeout=5)
(artifacts/'logcat.txt').write_text(run('logcat','-d','-v','threadtime').stdout,encoding='utf-8')
run('pull','/sdcard/Android/data/com.weston.fitquest/files',str(artifacts),check=False)
# Remove local synthetic queue after preserving evidence, so later app launches cannot upload it.
run('shell','pm','clear','com.weston.fitquest')
text=(artifacts/'instrumentation.txt').read_text(encoding='utf-8')
if code!=0 or 'OK (1 test)' not in text:raise SystemExit('Native emulator test failed; inspect artifacts.')
print('PASS: actual APK native emulator integration.',flush=True)
