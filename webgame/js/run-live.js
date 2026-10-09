// Opt-in, foreground-only sharing. No location backlog is retained or replayed.
const INITIAL = 'ยังไม่แชร์ตำแหน่ง · เปิดดูนักวิ่งได้โดยไม่ต้องเปิด GPS';
export function createLiveRunning({ data, onChange, now = Date.now,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let viewing = false, sharing = false, connected = false, visible = true, disposed = false;
  let people = new Map(), message = INITIAL, current, timer, opening, opened = false;
  let connectionEpoch = 0, viewEpoch = 0, writeEpoch = 0, eventRevision = 0;
  let writeQueue = Promise.resolve(), closing = Promise.resolve(), lastSent = -Infinity, lastFix = -Infinity, lastRead = -Infinity, reading = false;
  let publishing = false, hasPosition = false;
  function prune() {
    for (const [id, row] of people) if (Date.parse(row.expires_at) <= now()) people.delete(id);
  }
  function emit() {
    prune();
    onChange({ viewing, sharing, connected, loading: viewing && reading,
      people: viewing && connected && visible ? [...people.values()] : [], message });
  }
  function validRow(row) {
    return row && typeof row.user_id === 'string' && typeof row.display_name === 'string'
      && Number.isFinite(row.lat) && Math.abs(row.lat) <= 90 && Number.isFinite(row.lng) && Math.abs(row.lng) <= 180
      && Number.isFinite(Date.parse(row.updated_at)) && Date.parse(row.expires_at) > now();
  }
  function accept(row) {
    if (!validRow(row)) return;
    const previous = people.get(row.user_id);
    if (!previous || Date.parse(row.updated_at) >= Date.parse(previous.updated_at)) people.set(row.user_id, row);
    if (people.size > 500) {
      const oldest = [...people.values()].sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))[0];
      people.delete(oldest.user_id);
    }
  }
  function enqueue(operation) {
    const task = writeQueue.then(operation);
    writeQueue = task.catch(() => {}); return task;
  }
  function withdraw() {
    writeEpoch++;
    if (!hasPosition) return writeQueue.then(() => true);
    hasPosition = false;
    return enqueue(() => data.remove()).then(() => true).catch(() => {
      message = 'ถอนจุดออนไลน์ยังไม่สำเร็จ จุดจะหมดอายุในประมาณ 60 วินาที'; emit();
      return false;
    });
  }
  function disconnect() {
    const pendingConnection = opening;
    connectionEpoch++; connected = false; opened = false; opening = undefined;
    people.clear();
    if (timer) clearIntervalFn(timer); timer = undefined;
    // Stop/delete is serialized after any already-started publish.
    const removal = withdraw();
    closing = closing.then(async () => {
      await pendingConnection?.catch(() => {});
      await removal; await data.close().catch(() => {});
    });
    return closing;
  }
  function fail(error) {
    viewing = false; sharing = false; viewEpoch++; writeEpoch++;
    message = /anonymous|disabled/i.test(error?.message || '')
      ? 'ยังเชื่อมแผนที่สดไม่ได้ ต้องเปิด Anonymous Sign-Ins ใน Supabase ก่อน'
      : /account|auth/i.test(error?.message || '')
        ? 'บัญชีเปลี่ยนหรือหมดอายุ ปิดแชร์แล้ว กรุณาเปิดเชื่อมต่อใหม่'
        : 'แผนที่สดขาดการเชื่อมต่อ ปิดแชร์แล้ว เปิดสวิตช์ใหม่เพื่อลองอีกครั้ง';
    void disconnect(); emit();
  }
  async function read() {
    if (!viewing || !connected || reading || !visible) return;
    reading = true;
    emit();
    const epoch = viewEpoch, connection = connectionEpoch, revision = eventRevision;
    lastRead = now();
    try {
      const rows = await data.list();
      if (!viewing || epoch !== viewEpoch || connection !== connectionEpoch || !connected) return;
      // If realtime changed during the request, retain those newer events (including deletes).
      if (revision === eventRevision) {
        people.clear(); for (const row of rows) accept(row);
      } else lastRead = -Infinity;
      emit();
    } catch (error) { if (epoch === viewEpoch && connection === connectionEpoch) fail(error); }
    finally { reading = false; emit(); }
  }
  function freshPoint() {
    const point = current?.run?.points?.at(-1);
    if (!sharing || !visible || !connected || current?.mode !== 'running' || !point) return null;
    if (!Number.isFinite(point.timestamp) || now() - point.timestamp > 15000 || point.timestamp > now() + 10000
      || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180
      || !Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 40) return null;
    return { lat: point.lat, lng: point.lng, accuracy: point.accuracy, timestamp: point.timestamp };
  }
  function publish() {
    const point = freshPoint();
    if (!point || publishing || now() - lastSent < 5000 || point.timestamp <= lastFix) return;
    publishing = true;
    const epoch = writeEpoch, connection = connectionEpoch;
    void enqueue(async () => {
      if (epoch !== writeEpoch || connection !== connectionEpoch || !freshPoint() || now() - point.timestamp > 15000) return;
      // Mark before awaiting: a concurrent stop must enqueue deletion after this write.
      hasPosition = true; lastSent = now(); lastFix = point.timestamp;
      await data.put(point);
      if (epoch === writeEpoch && sharing) { message = 'กำลังแชร์จุดล่าสุด · หยุดส่งเมื่อพัก จบ หรือซ่อนแอป'; emit(); }
    }).catch(error => { if (connection === connectionEpoch && epoch === writeEpoch) fail(error); })
      .finally(() => { publishing = false; });
  }
  function tick() {
    emit(); publish();
    if (now() - lastRead >= 15000) void read();
  }
  async function ensureConnection() {
    await closing;
    if (opened || disposed || !(viewing || sharing)) return;
    if (opening) return opening;
    const epoch = connectionEpoch;
    message = 'กำลังเชื่อมแผนที่สด…'; emit();
    const operation = (async () => {
      try {
        await data.connect();
        if (epoch !== connectionEpoch || disposed || !(viewing || sharing)) return;
        opened = true;
        data.watch(event => {
          if (epoch !== connectionEpoch || !viewing || !connected) return;
          eventRevision++;
          if (event.eventType === 'DELETE') people.delete(event.old?.user_id);
          else accept(event.new);
          emit();
        }, status => {
          if (epoch !== connectionEpoch || disposed) return;
          if (status === 'SUBSCRIBED') {
            connected = true; message = sharing ? 'เปิดแชร์แล้ว · รอจุด GPS ใหม่ขณะวิ่ง' : 'แผนที่สดเชื่อมต่อแล้ว · แสดงเฉพาะผู้ที่เปิดแชร์';
            emit(); void read(); publish();
          } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'AUTH_CHANGED'].includes(status)) {
            fail(new Error(status === 'AUTH_CHANGED' ? 'Account changed' : 'Connection lost'));
          }
        });
        if (epoch === connectionEpoch) timer = setIntervalFn(tick, 5000);
      } catch (error) { if (epoch === connectionEpoch) fail(error); }
    })();
    opening = operation;
    await operation;
    if (opening === operation) opening = undefined;
  }
  emit();
  return {
    async setViewing(value) {
      if (disposed) return;
      viewing = Boolean(value); viewEpoch++; const request = viewEpoch;
      people.clear(); lastRead = -Infinity; emit();
      if (viewing) { await ensureConnection(); void read(); }
      else if (!sharing) { await disconnect(); if (request === viewEpoch && !sharing) { message = INITIAL; emit(); } }
    },
    async setSharing(value) {
      if (disposed) return;
      sharing = Boolean(value); writeEpoch++;
      if (!sharing) {
        const removed = await withdraw();
        if (!viewing && !sharing) await disconnect();
        if (!sharing) {
          message = removed ? 'ปิดแชร์ตำแหน่งแล้ว · การวิ่งยังบันทึกในเครื่อง'
            : 'หยุดส่งแล้ว แต่ถอนจุดออนไลน์ไม่สำเร็จ จุดจะหมดอายุในประมาณ 60 วินาที';
          emit();
        }
        return;
      }
      lastFix = -Infinity; lastSent = -Infinity;
      message = 'เปิดแชร์แล้ว · รอจุด GPS ใหม่ขณะวิ่ง'; emit();
      await ensureConnection(); publish();
    },
    update(value) {
      const previous = current?.mode; current = value;
      if (value.mode !== 'running') {
        if (previous === 'running' || hasPosition) void withdraw();
        if (sharing && previous !== value.mode) {
          message = 'หยุดส่งตำแหน่งแล้ว · จะส่งอีกเมื่อวิ่งต่อและมีจุด GPS ใหม่'; emit();
        }
      } else publish();
    },
    setVisible(value) {
      visible = Boolean(value);
      if (!visible) {
        people.clear(); void withdraw();
        if (sharing) message = 'ซ่อนแอปแล้ว หยุดส่งตำแหน่ง · จุดที่ค้างจะหมดอายุในประมาณ 60 วินาที';
      } else {
        if (sharing) message = 'เปิดแชร์แล้ว · รอจุด GPS ใหม่ขณะวิ่ง';
        lastRead = -Infinity; void read(); publish();
      }
      emit();
    },
    async dispose() {
      disposed = true; viewing = false; sharing = false; viewEpoch++;
      await disconnect(); emit();
    },
  };
}
