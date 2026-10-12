export function validateProfile(values) {
  const errors={};
  const labels={age:'อายุ',weight_kg:'น้ำหนัก',bmi:'BMI',body_fat_percent:'Fat',muscle_mass_kg:'กล้ามเนื้อ',height_cm:'ส่วนสูง'};
  const profile={sex:values.sex};
  for(const [key,label] of Object.entries(labels)) {
    const value=typeof values[key]==='number'?values[key]:values[key]?.trim()?Number(values[key]):NaN;
    if(!Number.isFinite(value)||value<=0) errors[key]=`กรอก${label}เป็นตัวเลขมากกว่า 0`;
    profile[key]=value;
  }
  if(!['male','female'].includes(profile.sex)) errors.sex='เลือกเพศที่ใช้กับข้อมูลอ้างอิงสุขภาพ';
  if(Number.isFinite(profile.age)&&(!Number.isInteger(profile.age)||profile.age>120)) errors.age='กรอกอายุเต็มปี 1–120';
  if(profile.body_fat_percent>=100) errors.body_fat_percent='Fat ต้องน้อยกว่า 100%';
  for(const key of ['height_cm','weight_kg']) if(profile[key]>=10000) errors[key]=`ตรวจ${labels[key]}และหน่วยอีกครั้ง`;
  if(profile.muscle_mass_kg>profile.weight_kg) errors.muscle_mass_kg='กล้ามเนื้อ (กก.) ต้องไม่เกินน้ำหนักตัว';
  if(Object.keys(errors).length) return {valid:false,errors,profile:null};
  const computedBmi=profile.weight_kg/(profile.height_cm/100)**2;
  if(!Number.isFinite(computedBmi)||computedBmi<=0) return {valid:false,errors:{height_cm:'ตรวจส่วนสูงและน้ำหนักอีกครั้ง'},profile:null};
  return {valid:true,errors:{},profile:{...profile,input_bmi:profile.bmi,bmi:computedBmi,
    measured_at:new Date().toISOString(),muscle_definition:null},
    notices:[...(Math.abs(computedBmi-profile.bmi)>.2?['ใช้ BMI ที่คำนวณจากน้ำหนักและส่วนสูงจริง']:[]),
      ...(profile.age<20?['เป้าหมายวัยรุ่นต้องรอ Growth Reference']:[]),
      ...(profile.muscle_mass_kg>profile.weight_kg*(1-profile.body_fat_percent/100)?['ค่านิยามกล้ามเนื้อต้องตรวจจากเครื่องชั่งก่อนคำนวณเป้าหมาย']:[])]};
}
