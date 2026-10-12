import * as THREE from 'three';
// Every facial feature is solid geometry. No photograph is used as a face texture.
export function buildAvatarHead(p){
  const root=new THREE.Group();root.name='weston-avatar-head-3d';
  const color=rgb=>new THREE.Color(`rgb(${rgb.map(v=>Math.round(Math.max(0,Math.min(255,v)))).join(',')})`);
  const skin=new THREE.MeshStandardMaterial({color:color(p.skin),roughness:.72});
  const hair=new THREE.MeshStandardMaterial({color:color(p.hair).multiplyScalar(.65),roughness:.85});
  const white=new THREE.MeshStandardMaterial({color:0xfffaf2,roughness:.4});
  const iris=new THREE.MeshStandardMaterial({color:color(p.iris).multiplyScalar(.6),roughness:.38});
  const dark=new THREE.MeshStandardMaterial({color:0x191511,roughness:.4});
  const lips=new THREE.MeshStandardMaterial({color:color(p.skin).lerp(new THREE.Color(0xa55550),.42),roughness:.65});
  const halfWidth=.38*p.width,halfHeight=.37,depth=.265;
  function mesh(name,geometry,material,position,scale){const o=new THREE.Mesh(geometry,material);o.name=name;o.position.set(...position);if(scale)o.scale.set(...scale);o.castShadow=true;o.receiveShadow=true;root.add(o);return o;}
  const sphere=()=>new THREE.SphereGeometry(1,32,24);
  const skull=sphere(),vertices=skull.attributes.position;
  for(let i=0;i<vertices.count;i++){const y=vertices.getY(i);if(y<0)vertices.setX(i,vertices.getX(i)*(1-(1-p.jaw)*(-y)));}
  skull.computeVertexNormals();mesh('face-volume',skull,skin,[0,0,0],[halfWidth,halfHeight,depth]);
  mesh('neck',new THREE.CylinderGeometry(.08,.10,.15,24),skin,[0,-.37,0]);
  for(const side of [-1,1]){
    mesh('ear',sphere(),skin,[side*halfWidth,.005,-.01],[.055,.085,.04]);
    const x=side*halfWidth*(.48+(p.eyeSpacing-.3)*.5),y=.035;
    const z=depth*Math.sqrt(Math.max(.1,1-(x/halfWidth)**2-(y/halfHeight)**2));
    const ew=halfWidth*p.eyeWidth*1.5,eh=Math.max(.052,halfHeight*p.eyeHeight*3);
    mesh('eye-white',sphere(),white,[x,y,z],[ew,eh,.031]);
    mesh('iris',sphere(),iris,[x,y,z+.029],[eh*.64,eh*.78,.011]);
    mesh('pupil',sphere(),dark,[x,y,z+.039],[eh*.34,eh*.48,.007]);
    mesh('eye-highlight',sphere(),white,[x-eh*.18,y+eh*.28,z+.046],[.008,.008,.005]);
    const brow=mesh('eyebrow',sphere(),hair,[x,y+eh+.028,z-.009],[ew,.014,.02]);brow.rotation.z=side*-.11;
  }
  mesh('nose-bridge',sphere(),skin,[0,-.01,depth-.012],[halfWidth*p.noseWidth*.43,halfHeight*p.noseLength*.72,.049]);
  mesh('nose-tip',sphere(),skin,[0,-.065,depth+.033],[halfWidth*p.noseWidth*.62,.041,.045]);
  const mw=halfWidth*p.mouthWidth;
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(-mw,-.145,.234),new THREE.Vector3(0,-.163,.253),new THREE.Vector3(mw,-.145,.234)]);
  mesh('mouth',new THREE.TubeGeometry(curve,24,.013,8,false),lips,[0,0,0]);
  mesh('hair-cap',new THREE.SphereGeometry(1,40,24,0,Math.PI*2,0,1.18),hair,[0,.008,-.012],[halfWidth*1.04,halfHeight*1.04,depth*1.05]);
  for(let i=0;i<3;i++){
    const x=(i-1)*halfWidth*.55;
    const lock=mesh('hair-lock',sphere(),hair,[x,.25+Math.abs(i-1)*.018,.19],[halfWidth*.4,.09,.075]);lock.rotation.z=-.3;
  }
  root.userData.faceParameters=p;return root;
}
export function disposeAvatarHead(head){
  const materials=new Set();head.traverse(o=>{o.geometry?.dispose();if(o.material)materials.add(o.material);});materials.forEach(m=>m.dispose());
}
