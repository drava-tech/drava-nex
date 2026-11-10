"""Bake diffuse illumination/AO and export a self-contained PBR GLB."""
import numpy as np,pickle,json,math,struct,time,io
from pathlib import Path
from PIL import Image
from scipy.ndimage import distance_transform_edt,gaussian_filter
import trimesh,xatlas
from trimesh.ray.ray_pyembree import RayMeshIntersector
WORK=Path(__file__).resolve().parent;OUT=WORK.parent;ROOT=OUT;MAPS=OUT/'maps'
scene=pickle.load(open(WORK/'scene.pkl','rb'));objs=scene['objects'];mats=scene['materials'];emitters=scene['emitters']
def norm(v):return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-12)
def srgb(c):return np.where(c<=.0031308,c*12.92,1.055*np.maximum(c,0)**(1/2.4)-.055)
V=np.concatenate([o['v'] for o in objs]);off=0;fs=[];fo=[]
for oi,o in enumerate(objs):fs.append(o['f']+off);fo.extend([oi]*len(o['f']));off+=len(o['v'])
F=np.concatenate(fs);FO=np.array(fo);tri=V[F];fn=norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]));ray=RayMeshIntersector(trimesh.Trimesh(V,F,process=False))
def hits(p,d):
 ids=ray.intersects_first(p,d);valid=ids>=0;q=ids[valid];dist=np.full(len(p),np.inf)
 den=np.sum(d[valid]*fn[q],axis=1);dist[valid]=np.sum((tri[q,0]-p[valid])*fn[q],axis=1)/np.where(abs(den)<1e-10,1e-10,den)
 return ids,dist
lights=[]
for e in emitters:
 if 'point' in e:lights.append((e['point'],e['normal'],e['power']))
 else:
  count=e['samples'];area=np.linalg.norm(np.cross(e['u'],e['v']))
  for i in range(count):
   a=((i%4)+.5)/4-.5;b=((i//4)+.5)/max(1,count/4)-.5
   lights.append((e['center']+a*e['u']+b*e['v'],e['normal'],e['radiance']*area/count))

start=time.time()
for oi,o in enumerate(objs):
 mat=mats[o['material']]
 if 'emission' in mat:
  
  if 'ui_image' in mat:
   c=np.asarray(Image.open(WORK/'assets'/mat['ui_image']).convert('RGB'),dtype=float)/255;o['radiance']=np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)*np.array(mat['emission'])
  else:o['radiance']=np.array(mat['emission'])
  continue
 a=xatlas.Atlas();a.add_mesh(o['v'].astype(np.float32),o['f'].astype(np.uint32),o['n'].astype(np.float32));po=xatlas.PackOptions();po.resolution=o['bake_res'];po.padding=4;a.generate(pack_options=po)
 vm,fi,uv=a[0];o['v']=o['v'][vm];o['n']=o['n'][vm];o['f']=fi.astype(int);o['uv']=uv
 h,w=a.height,a.width;P=np.zeros((h,w,3),np.float32);N=np.zeros_like(P);valid=np.zeros((h,w),bool)
 for face in fi:
  q=uv[face]*[w,h]-.5;lo=np.maximum(np.floor(q.min(0)).astype(int),[0,0]);hi=np.minimum(np.ceil(q.max(0)).astype(int),[w-1,h-1]);xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1));q0,q1,q2=q
  den=(q1[1]-q2[1])*(q0[0]-q2[0])+(q2[0]-q1[0])*(q0[1]-q2[1])
  if abs(den)<1e-10:continue
  aa=((q1[1]-q2[1])*(xx-q2[0])+(q2[0]-q1[0])*(yy-q2[1]))/den;bb=((q2[1]-q0[1])*(xx-q2[0])+(q0[0]-q2[0])*(yy-q2[1]))/den;cc=1-aa-bb;ok=(aa>=-1e-5)&(bb>=-1e-5)&(cc>=-1e-5);rr,cols=yy[ok],xx[ok];bc=np.stack([aa[ok],bb[ok],cc[ok]],1)
  P[rr,cols]=bc@o['v'][face];N[rr,cols]=bc@o['n'][face];valid[rr,cols]=True
 nearest=distance_transform_edt(~valid,return_distances=False,return_indices=True);p=P[valid];n=norm(N[valid]);origin=p+n*.002;ref=np.tile([0.,1.,0.],(len(p),1));ref[abs(n[:,1])>.95]=[1,0,0];t=norm(np.cross(ref,n));bit=np.cross(n,t)
 ao=np.zeros(len(p));illum=np.zeros((len(p),3))
 for i in range(16):
  r=math.sqrt((i+.5)/16);phi=i*2.3999632297;d=t*r*math.cos(phi)+bit*r*math.sin(phi)+n*math.sqrt(1-r*r);_,dist=hits(origin,d);ao+=1-np.exp(-np.maximum(dist,0)/.65)
 ao/=16
 for point,light_normal,power in lights:
  d=point-origin;dist=np.linalg.norm(d,axis=1);d/=np.maximum(dist[:,None],1e-9);nl=np.maximum(0,np.sum(n*d,axis=1));ll=np.maximum(0,-d@light_normal)
  _,hitdist=hits(origin,d);visible=hitdist>dist-.008;illum+=(nl*ll*visible/(dist*dist+.035))[:,None]*power/math.pi
 base=np.array(mat['base']);rgb=base*(1-mat['metal'])*illum+base*.070*(.2+.8*ao[:,None])
 image=np.zeros_like(P);image[valid]=rgb;image=image[tuple(nearest)];aomap=np.zeros((h,w));aomap[valid]=ao;aomap=aomap[tuple(nearest)]
 o.update(valid=valid,nearest=nearest,p=p,n_bake=n,t=t,bit=bit,direct=image,radiance=image.copy(),ao=aomap)
 print('Direct bake',oi,o['name'],w,h,'seconds',round(time.time()-start,1),flush=True)

# Refresh ray geometry order after atlas remapping (face order is preserved).
V=np.concatenate([o['v'] for o in objs]);off=0;fs=[];uvs=[]
for o in objs:fs.append(o['f']+off);off+=len(o['v']);uvs.append(o.get('uv',np.zeros((len(o['v']),2))))
F=np.concatenate(fs);UV=np.concatenate(uvs);tri=V[F];fn=norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]));ray=RayMeshIntersector(trimesh.Trimesh(V,F,process=False))
def radiance_samples(p,d,exclude_emitters=True):
 ids,dist=hits(p,d);valid=ids>=0;q=ids[valid];pos=p[valid]+d[valid]*dist[valid,None];bc=trimesh.triangles.points_to_barycentric(tri[q],pos);uv=(UV[F[q]]*bc[:,:,None]).sum(1);result=np.zeros((len(p),3));samples=np.zeros((len(q),3))
 for oi,o in enumerate(objs):
  mask=FO[q]==oi
  if not mask.any():continue
  if exclude_emitters and 'emission' in mats[o['material']]:continue
  im=o['radiance']
  if im.ndim==1:
   if not exclude_emitters:samples[mask]=im
  else:
   h,w=im.shape[:2];coords=uv[mask];samples[mask]=im[np.clip((coords[:,1]*h).astype(int),0,h-1),np.clip((coords[:,0]*w).astype(int),0,w-1)]
 result[valid]=samples;return result
for bounce in range(2):
 next_images=[]
 for oi,o in enumerate(objs):
  mat=mats[o['material']]
  if 'emission' in mat:next_images.append(o['radiance']);continue
  n=o['n_bake'];p=o['p']+n*.002;total=np.zeros_like(p)
  for i in range(16):
   r=math.sqrt((i+.5)/16);phi=i*2.3999632297;d=o['t']*r*math.cos(phi)+o['bit']*r*math.sin(phi)+n*math.sqrt(1-r*r);total+=radiance_samples(p,d)/16
  delta=np.zeros_like(o['direct']);delta[o['valid']]=total*np.array(mat['base'])*(1-mat['metal']);delta=delta[tuple(o['nearest'])];next_images.append(o['direct']+gaussian_filter(delta,(.6,.6,0)))
 for o,im in zip(objs,next_images):o['radiance']=im
 print('Diffuse bounce',bounce+1,'complete',round(time.time()-start,1),'seconds',flush=True)

j={'asset':{'version':'2.0','generator':'White Tusker product and tangible experience room','copyright':'Adapted shoe geometry © 2021 Shopify, CC BY 4.0. See scene extras and supplied credits.'},'scene':0,'scenes':[{'name':'White Tusker 50ft x 30ft x 14ft','nodes':[]}],'nodes':[],'meshes':[],'materials':[],'bufferViews':[],'accessors':[],'buffers':[{}],'images':[],'textures':[],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071},{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],'extensionsUsed':['KHR_materials_clearcoat','KHR_materials_emissive_strength'],'extras':scene['report']}
j['extras']['lighting']='Baked direct diffuse illumination, contact AO and two sampled diffuse bounce iterations; glossy reflections require environment lighting in the viewer.'
binary=bytearray()
def buf(b,target=None):
 binary.extend(b'\0'*((-len(binary))%4));bv={'buffer':0,'byteOffset':len(binary),'byteLength':len(b)}
 if target:bv['target']=target
 j['bufferViews'].append(bv);binary.extend(b);return len(j['bufferViews'])-1
def accessor(a,kind,comp=5126):
 a=np.asarray(a,dtype='<f4' if comp==5126 else '<u4');q={'bufferView':buf(a.tobytes(),34962 if comp==5126 else 34963),'count':len(a),'componentType':comp,'type':kind}
 if kind=='VEC3':q.update(min=a.min(0).tolist(),max=a.max(0).tolist())
 j['accessors'].append(q);return len(j['accessors'])-1
def texture(path,repeat=False):
 j['images'].append({'name':path.name,'mimeType':'image/png','bufferView':buf(path.read_bytes())});j['textures'].append({'source':len(j['images'])-1,'sampler':int(repeat)});return len(j['textures'])-1
# Same fine finish texture family as the approved smaller room.
for name in ['metal_micro_normal.png','metal_micro_roughness.png']:
 (MAPS/name).write_bytes((WORK/'assets'/name).read_bytes())
normal_tex=texture(MAPS/'metal_micro_normal.png',True);rough_tex=texture(MAPS/'metal_micro_roughness.png',True)
for oi,o in enumerate(objs):
 m=mats[o['material']];v,n,f=o['v'],o['n'],o['f'];attrs={'POSITION':accessor(v,'VEC3'),'NORMAL':accessor(n,'VEC3')};pbr={'baseColorFactor':m['base']+[1.],'metallicFactor':m['metal'],'roughnessFactor':m['rough']};mat={'name':o['material']+' / '+o['name'],'pbrMetallicRoughness':pbr,'doubleSided':True,'extensions':{},'extras':{'finish':o['material']}}
 if 'uv' in o:attrs['TEXCOORD_0']=accessor(o['uv'],'VEC2')
 if 'emission' in m:
  emission=np.array(m['emission']);strength=max(1,float(emission.max()));mat['emissiveFactor']=(emission/strength).tolist()
  if strength>1:mat['extensions']['KHR_materials_emissive_strength']={'emissiveStrength':strength}
  if 'ui_image' in m:
   path=MAPS/m['ui_image'];path.write_bytes((WORK/'assets'/m['ui_image']).read_bytes());mat['emissiveTexture']={'index':texture(path)}
 else:
  fname=f'{oi:02d}_{o["name"]}'
  Image.fromarray(np.uint8(np.clip(srgb(o['radiance'])*255,0,255))).save(MAPS/(fname+'_baked.png'),optimize=True);Image.fromarray(np.uint8(np.clip(o['ao']*255,0,255))).save(MAPS/(fname+'_ao.png'),optimize=True)
  tex=texture(MAPS/(fname+'_baked.png'));ao=texture(MAPS/(fname+'_ao.png'));mat['emissiveTexture']={'index':tex};mat['emissiveFactor']=[1,1,1];mat['occlusionTexture']={'index':ao,'strength':.35}
  axis=np.argmax(abs(n),axis=1);detail=np.zeros((len(v),2))
  for ax,comp in enumerate([(2,1),(0,2),(0,1)]):detail[axis==ax]=v[axis==ax][:,comp]*2.5
  attrs['TEXCOORD_1']=accessor(detail,'VEC2');pbr['metallicRoughnessTexture']={'index':rough_tex,'texCoord':1};mat['normalTexture']={'index':normal_tex,'texCoord':1,'scale':.18 if o['material']=='silver' else .10}
  if o['material'].startswith(('shoe_','logo_')):pbr.pop('metallicRoughnessTexture',None);mat['normalTexture']['scale']=.025
  e1=v[f[:,1]]-v[f[:,0]];e2=v[f[:,2]]-v[f[:,0]];d1=detail[f[:,1]]-detail[f[:,0]];d2=detail[f[:,2]]-detail[f[:,0]];det=d1[:,0]*d2[:,1]-d1[:,1]*d2[:,0];den=np.where(abs(det)>1e-10,det,1)
  ft=(e1*d2[:,1,None]-e2*d1[:,1,None])/den[:,None];fb=(e2*d1[:,0,None]-e1*d2[:,0,None])/den[:,None];t=np.zeros_like(v);bit=np.zeros_like(v)
  for c in range(3):np.add.at(t,f[:,c],ft);np.add.at(bit,f[:,c],fb)
  t-=n*np.sum(n*t,axis=1,keepdims=True);bad=np.linalg.norm(t,axis=1)<1e-8;ref=np.tile([0.,1.,0.],(int(bad.sum()),1));ref[abs(n[bad,1])>.95]=[1,0,0];t[bad]=np.cross(ref,n[bad]);t=norm(t);sign=np.where(np.sum(np.cross(n,t)*bit,axis=1)<0,-1.,1.);attrs['TANGENT']=accessor(np.column_stack([t,sign]),'VEC4')
 if m['coat']>0:mat['extensions']['KHR_materials_clearcoat']={'clearcoatFactor':m['coat'],'clearcoatRoughnessFactor':.22}
 if not mat['extensions']:mat.pop('extensions')
 # Preserve smooth shoe normals, UVs and baked material detail with compact indexed vertices.
 if o['material'].startswith(('shoe_','logo_')):
  mat.pop('normalTexture',None)
  attrs.pop('TANGENT',None);attrs.pop('TEXCOORD_1',None)
 j['materials'].append(mat);j['meshes'].append({'name':o['name'],'primitives':[{'attributes':attrs,'indices':accessor(f.reshape(-1),'SCALAR',5125),'material':oi}]});j['nodes'].append({'name':o['name'],'mesh':oi,'extras':o['extras']});j['scenes'][0]['nodes'].append(oi)
# Camera metadata gives compatible viewers an immediate interior starting point.
j['cameras']=[{'name':'Interior entry view','type':'perspective','perspective':{'yfov':math.radians(74),'znear':.02,'zfar':120,'aspectRatio':16/9}}];j['nodes'].append({'name':'Interior_Camera','camera':0,'translation':[0,1.85,4.10]});j['scenes'][0]['nodes'].append(len(j['nodes'])-1)
j['buffers'][0]['byteLength']=len(binary);binary.extend(b'\0'*((-len(binary))%4))
def write_glb(path,doc):
 js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);out=struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary;path.write_bytes(out);return len(out)
size=write_glb(OUT/'WT_Retail_Experience_Room.glb',j)
# A separate cutaway view makes the two experience zones inspectable in orbit viewers.
import copy
cut=copy.deepcopy(j);hidden=('Ceiling_','Warm_Perimeter','Wall_Rear','Entry_Header','Product_Ceiling_Light','Product_Light_Suspension','Product_Task_Light','Product_Fill_Light','Tangible_Ceiling_Light','Tangible_Light_Suspension','Tangible_Task_Light','Tangible_Fill_Light');cut['scenes'][0]['nodes']=[i for i in cut['scenes'][0]['nodes'] if not cut['nodes'][i]['name'].startswith(hidden)];cut['scenes'][0]['name']='Cutaway inspection variant — roof and rear wall hidden';write_glb(OUT/'WT_Retail_Experience_Room_Cutaway.glb',cut)
for o in objs:
 for key in ['p','n_bake','t','bit','valid','nearest','direct']:o.pop(key,None)
scene['geometry']={'V':V,'F':F,'FO':FO,'UV':UV};scene['bake']={'direct_samples':len(lights),'ao_samples':16,'diffuse_bounces':2,'samples_per_bounce':16,'seconds':round(time.time()-start,1),'output_bytes':size};pickle.dump(scene,open(WORK/'baked_scene.pkl','wb'))
(OUT/'Bake_Report.json').write_text(json.dumps(scene['bake'],indent=2));print('SAVED',size,'bytes',round(time.time()-start,1),'seconds',flush=True)
