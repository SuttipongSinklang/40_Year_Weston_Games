import { playerSession } from './data.js?v=20261012-2';
export async function profileSession() { return playerSession(); }
export async function fetchCloudProfile(api) {
  const {data,error}=await api.from('weston_health_profiles').select('*').eq('user_id',api.userId).maybeSingle();
  if(error) throw error;
  if(!data)return null;
  let photo=null;
  if(data.avatar_path){const result=await api.storage.from('weston-private-avatars').download(data.avatar_path);if(result.error)throw result.error;photo=result.data;}
  return {owner:api.userId,profile:{age:data.age,sex:data.sex,weight_kg:data.weight_kg,bmi:data.bmi,input_bmi:data.input_bmi,
    body_fat_percent:data.body_fat_percent,muscle_mass_kg:data.muscle_mass_kg,height_cm:data.height_cm,measured_at:data.measured_at,muscle_definition:data.muscle_definition},
    photo,photo_revision:data.photo_revision,cloud_state:'saved',revision:data.revision};
}
export async function saveCloudProfile(api,record) {
  if(record.owner!==api.userId)throw new Error('Profile belongs to another player');
  let avatar_path=null;
  if(record.photo){
    avatar_path=`${api.userId}/${record.photo_revision}.jpg`;
    const {error}=await api.storage.from('weston-private-avatars').upload(avatar_path,record.photo,{contentType:'image/jpeg',upsert:true});
    if(error)throw error;
  }
  const row={user_id:api.userId,...record.profile,avatar_path,photo_revision:record.photo?record.photo_revision:null,revision:record.revision};
  const {error}=await api.from('weston_health_profiles').upsert(row,{onConflict:'user_id'});
  if(error)throw error;
  const result=await api.from('weston_health_profiles').select('revision').eq('user_id',api.userId).single();
  if(result.error)throw result.error;
  if(result.data.revision!==record.revision)throw new Error('Profile save has not been confirmed');
}
