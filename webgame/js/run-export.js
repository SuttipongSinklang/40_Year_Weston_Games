import { toGPX } from './run-core.js';
import { isNativeApp } from './run-native-tracker.js';

export async function shareNativeGPX(run, bridge) {
  const { Filesystem, Directory, Encoding, Share } = bridge || await import('../assets/vendor/capacitor/native-bridge.js');
  const filename = `weston-run-${run.started_at.slice(0,10)}-${run.id.slice(0,8)}.gpx`;
  const { uri } = await Filesystem.writeFile({ path: filename, data: toGPX(run), directory: Directory.Cache, encoding: Encoding.UTF8 });
  try { await Share.share({ title: 'เส้นทางการวิ่ง Weston', dialogTitle: 'ส่งออกไฟล์ GPX', files: [uri] }); }
  catch (error) { if (!/cancel/i.test(error?.message || '')) throw error; }
}

export async function exportGPX(run) {
  if (isNativeApp()) return shareNativeGPX(structuredClone(run));
  const blob = new Blob([toGPX(run)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `weston-run-${run.started_at.slice(0,10)}-${run.id.slice(0,8)}.gpx`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
