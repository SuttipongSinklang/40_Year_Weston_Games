# Weston Fit Quest — แอป Android / iPhone

เพิ่มโค้ดแอป Capacitor **8.5.3** และปลั๊กอิน GPS ของโปรเจกต์แล้ว เพื่อเก็บตำแหน่งใน native ขณะล็อกจอหรือสลับแอป หน้าเกมใช้ไฟล์เดียวกับ `../webgame` โดยแพ็กสะพาน native และ Three.js เข้าแอป ไม่ใช้ localhost:8080 เป็นเซิร์ฟเวอร์ของแอปจริง

**สถานะการตรวจ 2026-10-09 (อัปเดต 12:00):** build ใหม่หลังแก้หน้าวิ่งค้างบนเครื่องจริง อาการ: ติดตั้งแล้วเข้าหน้าวิ่งได้ แต่ "กำลังโหลดแผนที่ถนน…" ค้างตลอด และกดปุ่มเริ่มวิ่งเงียบ สาเหตุ: `getTreadmillState` รอ `runOnUiThread` ที่ไม่เสร็จ ทำให้ `initializeRunning` รอค้างก่อนคืน `enter()` และ Capacitor ไม่ reject การเรียกที่ Java โยน exception (Bridge.java log แล้วทิ้ง) การแก้: (1) `running.js` ไม่ await treadmill init ก่อนคืน enter() (2) `run-native-treadmill.js`/`run-native-tracker.js` ครอบ plugin calls ด้วย timeout 15 วินาที (3) `WestonRunningPlugin.java` ย้าย read/ack/distance ขอ treadmill ออกจาก UI thread ไป bridge thread แบบ `getState` และทุก `runOnUiThread` มี `post()` ช่วย reject เสมอเมื่อ post ไม่ได้ ตรวจ JS/Java ที่แก้แล้วอยู่ใน APK (unzip ตรวจแล้ว) ไฟล์ติดตั้ง `../webgame/downloads/weston-fit-quest.apk` (debug signed, Android 7.0/API24 ขึ้นไป, 24,978,665 bytes, SHA256 85378D93…4AFA) ดาวน์โหลดบน Wi-Fi เดียวกันที่ http://192.168.10.85:8080/downloads/weston-fit-quest.apk — **ให้อัปเดตทับแอปเดิมเพื่อเก็บข้อมูลการวิ่งไว้** ยังไม่ทดสอบ GPS/ลู่วิ่งขณะล็อกจอบนโทรศัพท์จริง ส่วน iPhone ยังต้อง Mac/Xcode/signing เพื่อสร้าง IPA

**หมายเหตุ build บนเครื่องนี้:** ไม่มี Java/Android SDK ในระบบ ใช้ JDK 21 กับ SDK ที่ cache ไว้ที่ `C:\Users\suwij\.cache\weston-android-build\` โดยตั้ง `JAVA_HOME=C:\Users\suwij\.cache\weston-android-build\java\jdk-21.0.12.1+1` และ `ANDROID_HOME=C:\Users\suwij\.cache\weston-android-build\sdk` ก่อนเรียก `gradlew.bat :app:assembleDebug`

## วิธีเตรียมและ build

แผนที่นักวิ่งสดใช้ WebView/Supabase ขณะเปิดแอปอยู่ และต้องเปิดแชร์ตำแหน่งแยกจากการอนุญาต GPS เมื่อซ่อนแอปจะถอนจุดแบบ best effort หรือหมดอายุภายในประมาณ 60 วินาที ปลั๊กอิน native ยังคงบันทึกในเครื่องขณะล็อกจอ แต่ไม่ได้อัปโหลดตำแหน่งสดในพื้นหลัง

ต้องใช้ Node.js >=22 แนะนำติดตั้ง dependencies จาก lockfile:

```sh
cd mobile
npm ci
npm run sync
```

Android ต้องติดตั้ง Android Studio 2025.2.1 หรือใหม่กว่า, JDK 21, Android SDK Platform 36 และตั้ง SDK/JAVA_HOME ตามเครื่อง แล้วเปิด:

```sh
npm run open:android
```

หรือ build debug APK ด้วย Gradle ใน `android`: Windows `gradlew.bat :app:assembleDebug`, macOS/Linux `./gradlew :app:assembleDebug` ไฟล์ผลลัพธ์อยู่ `android/app/build/outputs/apk/debug/app-debug.apk` ต้อง build สำเร็จก่อนจึงมีไฟล์นี้

iPhone ต้องใช้ Mac + Xcode ที่รองรับ Capacitor 8 และ iPhone/iOS 15 ขึ้นไป:

```sh
npm run sync:ios
npm run open:ios
```

เลือก Signing Team ของเจ้าของแอปใน Xcode แล้ว build/run บน iPhone การเปิด `http://localhost:8080` หรือเพิ่มเว็บลงหน้าจอ Home **ไม่ได้**ติดตั้งบริการ native เหล่านี้ Android Studio/Xcode จะขอจัดการ signing ของแต่ละแพลตฟอร์ม ไม่มีการส่งขึ้น Play Store/App Store ในงานนี้

## การทำงาน

ทดสอบ APK 1.0.2 บน Android 15 Emulator แล้ว: แผนที่ถนน, เริ่ม/พัก/วิ่งต่อ,
จุด P1/R1, บันทึก GPS ขณะสลับแอป 10 วินาทีและดับจอ 8 วินาที,
รวมถึงเส้นทางบนแผนที่หลังจบ ผ่านทั้งหมด ใช้ GPS จำลองกับ native service จริง
รายละเอียดและภาพอยู่ `tests/artifacts/android-emulator/README.md`
ยังต้องทดสอบมือถือจริง การล็อกจอนาน โหมดลู่ และการอัปโหลดออนไลน์แยกต่างหาก

- กดเริ่มวิ่งในแอปที่เปิดอยู่ จึงขอสิทธิ์ตำแหน่งที่แม่นยำ เวลาเริ่มเมื่อได้ GPS ที่ชัดเจน กดพัก/จบหยุด GPS
- Android ใช้ location foreground service พร้อมแจ้งเตือนที่มีปุ่มพัก ขอสิทธิ์แจ้งเตือนใน Android 13+ ไม่มี permission ตำแหน่งตลอดเวลาหรือเริ่มใหม่หลัง reboot
- iPhone ใช้ Core Location fitness, location background mode, When In Use + precise location และแสดงตัวบอกตำแหน่ง ไม่มีการขอ Always หรือติดตามหลังบังคับปิดแอป
- native เก็บเหตุการณ์ลง journal ในพื้นที่ส่วนตัวก่อนแจ้งหน้าเกม หน้าเว็บถูกพัก/ซ่อนได้โดยไม่ต้องมี JavaScript รันอยู่ เมื่อกลับมาอ่านเหตุการณ์ที่เก็บไว้และคำนวณที่เวลาจับ GPS จริง
- บนมือถือ native การเปลี่ยนเมนูไม่พักการวิ่ง ผู้ใช้กดพัก/จบเอง เว็บในเบราว์เซอร์ยังพักเมื่อซ่อนหน้าและยังต้อง HTTPS สำหรับ GPS
- หาก process หยุดจริง กู้กลับเป็นพัก ณ เหตุการณ์สุดท้าย ไม่คิดเวลาที่แอปไม่ได้บันทึกและไม่เปิด GPS เอง แบตเตอรี่/OS/force-stop อาจหยุดบริการได้ ต้องตรวจบนโทรศัพท์เป้าหมาย
- native จำกัด **10000 GPS fixes ต่อรอบ** แล้วพักและขอให้บันทึก เพื่อไม่เกินเพดานเส้นทางของระบบเดิม จังหวะ GPS ขาดเกิน 30 วินาทีแยกเส้นทาง ไม่ลากเส้นสมมติข้ามช่วงที่ขาด
- บันทึกประวัติใน IndexedDB สำเร็จก่อน acknowledge ล้าง journal หากพื้นที่เต็ม/bridge ล้มเหลวยังเก็บต้นฉบับและกดบันทึกซ้ำได้ ไม่มี XP จาก GPS
- เส้นทางเก็บในเครื่อง ไม่ส่ง GPS จาก native ไปเครือข่าย เมื่อจบ ระบบส่งข้อมูลไป Supabase ส่วนตัวโดยอัตโนมัติ มีคิวทนต่อเน็ตขาดและไม่เปลี่ยนเจ้าของรายการ Anonymous Sign-Ins เปิดและทดสอบเชื่อมจริงแล้ว
- เอาปุ่ม GPX และสำรองออนไลน์ออกแล้ว หน้าจบแสดงเส้นทางกับจุด P/R ตามครั้งที่พัก/วิ่งต่อ และสถานะบันทึกออนไลน์ที่ยืนยันจริง
- แผนที่ถนน OSM/สำรองออนไลน์ต้องใช้อินเทอร์เน็ตและความยินยอมเดิม ฟอนต์ออนไลน์มี fallback เมื่อไม่มีเน็ต native GPS ไม่ขึ้นกับเน็ต

## ทดสอบก่อนใช้งานจริง

รันทดสอบข้อมูลจำลองจาก root: `npm test --prefix tests` ไม่ใช่การทดสอบบริการ GPS ของ OS

ต้อง build บนอุปกรณ์จริงและตรวจทั้งหมดนี้ **แยกทั้ง Android/iPhone**:

1. ปฏิเสธ permission/เลือกตำแหน่งคร่าว ๆ/ปิด GPS: อธิบายข้อผิดพลาด ไม่มีการเริ่มจับ GPS เงียบ ๆ
2. อนุญาต precise และเริ่มในที่เปิด: รอ first fix แล้วล็อกจอวิ่งอย่างน้อย 15 นาที ตรวจเส้นทางและระยะทางที่กลับมา ไม่มีช่วงเส้นเชื่อมสมมติ
3. สลับแอป/เปลี่ยนเมนูเกมระหว่างวิ่ง: capture ต่อและคำสั่งพัก/จบกลับมาทำงาน Android ปุ่มพักในแจ้งเตือนต้องหยุด GPS จริง
4. พักแล้วล็อกจอ/เคลื่อนที่/วิ่งต่อ: ไม่นับเวลาพักและไม่เชื่อมระยะทางที่เคลื่อนที่ระหว่างพัก
5. ไม่เปิดอินเทอร์เน็ต: capture และประวัติในเครื่องทำงาน ข้อมูลไม่ไป Supabase/OSM เอง
6. ปิด permission ระหว่างวิ่ง, battery saver และหยุด process: ต้องหยุด/กู้สถานะตรงจริง ไม่มีการนับย้อนหลังจาก GPS ที่ไม่มี
7. บังคับปิดและเปิดใหม่: กู้ journal เป็นพัก ไม่เปิด GPS เอง; WebView reload ใน process เดิมต้องไม่ทำให้ native หยุด
8. Finish, เปิดใหม่, กดซ้ำ: มีประวัติหนึ่งรายการ บันทึกออนไลน์อัตโนมัติและมีเส้นทาง/จุดพักครบ และ native journal ถูกล้างหลังบันทึกเท่านั้น

ข้อกำหนด native อยู่ใน [CONTRACT.md](CONTRACT.md) สถานะการตรวจอยู่ใน `../tests/artifacts/verification.md`

อ้างอิง: [Android foreground location](https://developer.android.com/develop/sensors-and-location/location/permissions), [Apple background location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background), [Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup), [Share API](https://capacitorjs.com/docs/apis/share), [Filesystem privacy manifest](https://capacitorjs.com/docs/apis/filesystem)

## ทดสอบโหมดลู่ขณะล็อกจอ

native treadmill ใช้ API/journal แยกจาก outdoor GPS ดู CONTRACT.md ก้าวและเวลารวมต่อเมื่อจอดับ (iPhone รวมจาก cache เมื่อปลดล็อก; Android ใช้ health service กับ CPU wake lock). ไม่มี GPS/การส่งก้าวจาก native ไปเครือข่าย เว็บ/PWA ยัง foreground-only. Android APK build แล้ว; iPhone ยังไม่มี IPA และทั้งสองยังต้องทดสอบบนโทรศัพท์จริง

ทดสอบทั้งสองแพลตฟอร์ม: เริ่มพกโทรศัพท์บนลู่แล้วล็อก 15 นาที → ปลดล็อกตรวจเวลา/ก้าว → พักแล้วเดินโดยล็อกจอ 2 นาที → วิ่งต่อ → จบ; ก้าวและเวลาพักต้องไม่รวม. Android ทดสอบปุ่มพักในแจ้งเตือน, ปิดสิทธิ์กิจกรรม, battery saver และการหยุด service. iPhone ทดสอบการอนุญาต Motion & Fitness, query หลังล็อก, query failure และอนุญาตถูกถอน. ทดสอบ reload WebView (native ยังทำงาน), kill/force-quit (กู้ paused ไม่ต่อเอง), finish ซ้ำ/history write หรือ ack failure (หนึ่งประวัติและต้นฉบับคงอยู่). ทดสอบ manual timer ด้วย. ระยะทางยังต้อง calibrate stride; counter fallback Android เสียก้าวก่อน baseline แรกได้

## APK 1.0.1 — map startup fix (2026-10-09)

Native outdoor tracker initialization now runs independently of map entry. Even pending GPS recovery cannot delay the street map. Recording controls remain disabled until authoritative native state is ready. Treadmill recovery still waits for outdoor recovery to avoid replacing an active run. Regression tests passed: running-boot and run-map (5 tests). Android debug build succeeded; versionCode 2/versionName 1.0.1, signing certificate matches previous APK. Packaged running code and Leaflet JS/CSS verified byte-for-byte; complete LAN download matches the APK. Download: http://192.168.1.181:8080/downloads/weston-fit-quest-1.0.1.apk. Update over the existing app; do not uninstall and lose local records. Phone confirmation of the reported issue is still pending.

## APK 1.0.2 — native Proxy loading fix (2026-10-09)

Phone screenshot showed untouched loading placeholders, no Leaflet controls and disabled start. Found earlier startup blocker: async nativeRunningPlugin returned the Capacitor Proxy directly. Capacitor core 8.5.3 synthesizes a callable then property, so Promise resolution invokes an unsupported WestonRunning.then and never settles. The loader now returns a plain object containing the proxy; running.js unwraps and reuses the handle for all three trackers. Actual Capacitor proxy regression verifies no then access and successful getState; pending native recovery still permits map entry. Boot/map tests: 6 passed. Built versionCode 3/versionName 1.0.2 with the same signing certificate, so update in place to retain local records. Packaged assets and full HTTP download verified. APK SHA256: d82a12f08b01924e184c5f7b9d6728628a55fb78d47e4b6f1b97d663719c5c48. Download: http://192.168.1.181:8080/downloads/weston-fit-quest-1.0.2.apk. Device confirmation remains pending; no attached Android device available for direct WebView logs.
