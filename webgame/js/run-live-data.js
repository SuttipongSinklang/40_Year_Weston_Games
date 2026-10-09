import { playerSession } from './data.js?v=20261009-6';

const TABLE = 'weston_live_runners';
const COLUMNS = 'user_id,lat,lng,accuracy,fix_at,display_name,updated_at,expires_at';
export function createLiveData(session = playerSession) {
  let api, owner, channel, authListener, statusListener;
  async function identity() {
    const { data, error } = await api.auth.getSession();
    if (error) throw error;
    if (!owner || data.session?.user.id !== owner) throw new Error('Account changed');
  }
  return {
    async connect() {
      api = await session();
      const { data, error } = await api.auth.getSession();
      if (error) throw error;
      owner = data.session?.user.id;
      if (!owner) throw new Error('No player session');
      authListener = api.auth.onAuthStateChange((_event, value) => {
        if (value?.user.id !== owner) queueMicrotask(() => statusListener?.('AUTH_CHANGED'));
      }).data.subscription;
      return owner;
    },
    async list() {
      await identity();
      const result = await api.from(TABLE).select(COLUMNS)
        .gt('expires_at', new Date().toISOString()).order('updated_at', { ascending: false }).limit(500);
      if (result.error) throw result.error;
      return result.data || [];
    },
    watch(onEvent, onStatus) {
      statusListener = onStatus;
      // Channel names are not credentials; support LAN HTTP browsers without randomUUID.
      channel = api.channel(`weston-live-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, onEvent)
        .subscribe(onStatus);
    },
    async put(point) {
      await identity();
      const result = await api.from(TABLE).upsert({ user_id: owner, lat: point.lat, lng: point.lng,
        accuracy: point.accuracy, fix_at: new Date(point.timestamp).toISOString() }, { onConflict: 'user_id' });
      if (result.error) throw result.error;
    },
    async remove() {
      if (!api || !owner) return;
      await identity();
      const result = await api.from(TABLE).delete().eq('user_id', owner);
      if (result.error) throw result.error;
    },
    async close() {
      statusListener = undefined;
      authListener?.unsubscribe(); authListener = undefined;
      const old = channel; channel = undefined;
      if (api && old) await api.removeChannel(old);
    },
  };
}
