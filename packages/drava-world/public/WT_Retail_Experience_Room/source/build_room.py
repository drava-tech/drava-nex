"""Dimensioned White Tusker product and tangible experience room, meters, Y up."""
from pathlib import Path
import numpy as np
import trimesh,json,struct,pickle,math
WORK=Path(__file__).resolve().parent;OUT=WORK.parent;ROOT=OUT
FT=.3048;W,D,H=np.array([50,30,14])*FT
objects=[];emitters=[]
# Linear base colours, metalness, roughness, clearcoat, emission.
materials={
 'graphite':dict(base=[.025,.029,.034],metal=.78,rough=.30,coat=.24),
 'red_metal':dict(base=[.32,.020,.008],metal=.68,rough=.32,coat=.32),
 'floor':dict(base=[.030,.034,.039],metal=.60,rough=.25,coat=.32),
 'ceiling':dict(base=[.028,.032,.038],metal=.68,rough=.34,coat=.16),
 'black_trim':dict(base=[.010,.012,.015],metal=.75,rough=.25,coat=.22),
 'silver':dict(base=[.63,.66,.70],metal=.88,rough=.29,coat=.10),
 'kiosk_pearl':dict(base=[.63,.65,.68],metal=.50,rough=.27,coat=.30),
 'white_screen':dict(base=[.025,.027,.03],metal=0.,rough=.32,coat=.10,emission=[1.1,1.14,1.18]),
 'kiosk_screen':dict(base=[.015,.02,.025],metal=0.,rough=.23,coat=.20,emission=[.75,.82,.88]),
 'disc_light':dict(base=[.03,.03,.03],metal=0.,rough=.6,coat=0,emission=[2.5,2.25,2.0]),
 'cove_light':dict(base=[.03,.025,.02],metal=0.,rough=.5,coat=0,emission=[3.0,1.8,1.1]),
}
def rotation(axis,angle):return trimesh.transformations.rotation_matrix(angle,axis)
def add(name,mesh,mat,transform=None,extras=None,bake_res=256):
 mesh=mesh.copy()
 if transform is not None:mesh.apply_transform(transform)
 # Flat architectural faces with smoothly rounded outline segments.
 v=np.asarray(mesh.vertices).copy();f=np.asarray(mesh.faces).copy()
 # Smooth only across neighbouring faces whose normals differ by <35 degrees.
 fn=mesh.face_normals;norm=[]
 vf=mesh.vertex_faces
 for fi,face in enumerate(f):
  for vi in face:
   adjacent=vf[vi];adjacent=adjacent[adjacent>=0];close=adjacent[(fn[adjacent]@fn[fi])>math.cos(math.radians(35))]
   nn=(fn[close]*mesh.area_faces[close,None]).sum(0);nn/=max(np.linalg.norm(nn),1e-9);norm.append(nn)
 n=np.asarray(norm);vertices=v[f].reshape(-1,3);faces=np.arange(len(vertices)).reshape(-1,3)
 objects.append(dict(name=name,v=vertices,n=n,f=faces,material=mat,extras=extras or {},bake_res=bake_res))
 return objects[-1]
def box(name,size,center,mat,extras=None,bake_res=256):
 mesh=trimesh.creation.box(extents=size);mesh.apply_translation(center);return add(name,mesh,mat,extras=extras,bake_res=bake_res)
def rounded_loop(w,h,r,n=10):
 pts=[]
 for cx,cy,start in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
  for a in np.linspace(start,start+90,n,endpoint=False):pts.append([cx+r*math.cos(math.radians(a)),cy+r*math.sin(math.radians(a))])
 return np.array(pts)
def slab(w,h,r,depth,bevel=.01):
 b=min(bevel,depth*.25,r*.4);loops=[]
 for z,inset in [(-depth/2,b),(-depth/2+b,0),(depth/2-b,0),(depth/2,b)]:
  xy=rounded_loop(w-2*inset,h-2*inset,r-inset);loops.append(np.column_stack([xy,np.full(len(xy),z)]))
 verts=np.concatenate(loops);count=len(loops[0]);faces=[]
 for layer in range(3):
  for i in range(count):
   k=(i+1)%count;a=layer*count+i;c=(layer+1)*count+i;bb=layer*count+k;dd=(layer+1)*count+k;faces.extend([[a,bb,dd],[a,dd,c]])
 verts=np.vstack([verts,[0,0,-depth/2],[0,0,depth/2]])
 for i in range(count):
  k=(i+1)%count;faces.extend([[4*count,k,i],[4*count+1,3*count+i,3*count+k]])
 return trimesh.Trimesh(verts,faces,process=False)
def transform(center,axis=None,angle=0):
 t=np.eye(4) if axis is None else rotation(axis,angle);t[:3,3]=center;return t
def plane(name,width,height,center,mat,ry=0,rx=0,extras=None):
 v=np.array([[-width/2,-height/2,0],[width/2,-height/2,0],[width/2,height/2,0],[-width/2,height/2,0]])
 t=transform(center,[0,1,0],ry)@rotation([1,0,0],rx)
 mesh=trimesh.Trimesh(v,[[0,1,2],[0,2,3]],process=False);o=add(name,mesh,mat,t,extras=extras,bake_res=0)
 # Preserve 0..1 screen UVs on the independent active display surface.
 uv=np.array([[0,1],[1,1],[1,0],[0,0]])
 o['uv']=uv[np.array([[0,1,2],[0,2,3]])].reshape(-1,2)
 return o,t

import copy
from trimesh.ray.ray_pyembree import RayMeshIntersector
import mapbox_earcut
import gzip
baseline=pickle.load(gzip.open(WORK/'room_shell.pkl.gz','rb'))
materials=copy.deepcopy(baseline['materials'])
objects=[copy.deepcopy(o) for o in baseline['objects'] if not o['name'].startswith(('Screen_','Kiosk_','White_Tusker'))]
emitters=copy.deepcopy(baseline['emitters'][4:-1])
materials.update({
 'table_graphite':dict(base=[.070,.080,.092],metal=.45,rough=.31,coat=.24),
 'gold':dict(base=[.68,.40,.105],metal=.86,rough=.25,coat=.22),
 'champagne':dict(base=[.59,.43,.20],metal=.75,rough=.31,coat=.15),
 'niche_back':dict(base=[.30,.19,.05],metal=.68,rough=.40,coat=.12),
 'shoe_sole':dict(base=[.80,.80,.75],metal=0,rough=.66,coat=0),
 'shoe_white':dict(base=[.80,.83,.84],metal=0,rough=.62,coat=0),
 'shoe_black':dict(base=[.018,.025,.035],metal=0,rough=.60,coat=0),
 'shoe_red':dict(base=[.45,.023,.011],metal=0,rough=.56,coat=0),
 'shoe_blue':dict(base=[.02,.12,.30],metal=0,rough=.56,coat=0),
 'shoe_olive':dict(base=[.17,.22,.13],metal=0,rough=.60,coat=0),
 'shoe_sand':dict(base=[.60,.43,.24],metal=0,rough=.61,coat=0),
 'logo_white':dict(base=[.92,.91,.85],metal=.10,rough=.30,coat=.1),
 'logo_black':dict(base=[.006,.007,.008],metal=.10,rough=.35,coat=.1),
 'warm_led':dict(base=[.04,.025,.01],metal=0,rough=.5,coat=0,emission=[3.5,2.4,1.2]),
 'cyan_led':dict(base=[.01,.02,.025],metal=0,rough=.4,coat=0,emission=[.08,.80,1.]),
 'red_led':dict(base=[.02,.002,.001],metal=0,rough=.4,coat=0,emission=[1.4,.055,.02]),
 'ui_kiosk':dict(base=[.012,.015,.02],metal=0,rough=.22,coat=.18,emission=[1.,1.,1.],ui_image='kiosk_ui.png'),
 'ui_table':dict(base=[.012,.015,.02],metal=0,rough=.20,coat=.22,emission=[1.,1.,1.],ui_image='table_ui.png'),
 'ui_wall':dict(base=[.012,.015,.02],metal=0,rough=.27,coat=.10,emission=[1.3,1.3,1.3],ui_image='wall_ui.png'),
 'label_shoes':dict(base=[0,0,0],metal=0,rough=.7,coat=0,emission=[.75,.75,.75],ui_image='shoe_title.png'),
 'label_table':dict(base=[0,0,0],metal=0,rough=.7,coat=0,emission=[.75,.75,.75],ui_image='table_title.png'),
})
def cylinder(name,r,h,center,mat,axis='y',sections=64,res=128):
 mesh=trimesh.creation.cylinder(radius=r,height=h,sections=sections)
 return add(name,mesh,mat,transform(center,[1,0,0],-math.pi/2) if axis=='y' else transform(center),bake_res=res)
def annulus_mesh(ro,ri,depth,n=64):
 a=np.linspace(0,2*math.pi,n,endpoint=False);cs=np.column_stack([np.cos(a),np.sin(a)])
 v=np.concatenate([np.column_stack([cs*r,np.full(n,z)]) for r,z in [(ro,-depth/2),(ro,depth/2),(ri,-depth/2),(ri,depth/2)]])
 f=[]
 for i in range(n):
  k=(i+1)%n
  for a0,b0 in [(0,n),(3*n,2*n),(n,3*n),(2*n,0)]:f.extend([[a0+i,a0+k,b0+k],[a0+i,b0+k,b0+i]])
 return trimesh.Trimesh(v,f,process=False)
def ring(name,r,thick,depth,center,mat,res=128):return add(name,annulus_mesh(r,r-thick,depth),mat,transform(center),bake_res=res)
def combine(meshes):return trimesh.util.concatenate(meshes)
def at(mesh,center):m=mesh.copy();m.apply_translation(center);return m
# Replace the previous display wall with two deliberate, equally weighted zones.
LX,RX=-3.80,3.80
add('Product_Feature_Panel',slab(4.55,3.25,.06,.09,.012),'graphite',transform([LX,2.05,-4.43]),bake_res=512)
add('Tangible_Feature_Panel',slab(4.55,3.25,.06,.09,.012),'graphite',transform([RX,2.05,-4.43]),bake_res=512)
for cx in [LX,RX]:
 for sx in [-1,1]:box(('Product' if cx<0 else 'Tangible')+('_Trim_Left' if sx<0 else '_Trim_Right'),[.020,3.08,.016],[cx+sx*2.18,2.05,-4.373],'champagne',bake_res=64)
plane('Product_Zone_Title',3.50,.38,[LX,3.32,-4.373],'label_shoes')
plane('Tangible_Zone_Title',3.50,.38,[RX,3.32,-4.373],'label_table')
# Six reference-inspired circular gold niches: three columns x two rows.
R=.46;pod_locations=[]
for row,cy in enumerate([2.55,1.35]):
 for col,dx in enumerate([-1.30,0,1.30]):
  idx=row*3+col+1;cx=LX+dx;cz=-4.19;pod_locations.append([cx,cy,cz])
  ring(f'Product_Niche_{idx:02d}_Gold_Ring',R,R*.07,.29,[cx,cy,cz],'gold',192)
  cylinder(f'Product_Niche_{idx:02d}_Back',R-.029,.019,[cx,cy,-4.334],'niche_back','z',64,128)
  ring(f'Product_Niche_{idx:02d}_Halo',R-.031,.012,.008,[cx,cy,-4.049],'warm_led',0)
  box(f'Product_Niche_{idx:02d}_Shelf',[.64,.022,.255],[cx,cy-.11,-4.181],'champagne',bake_res=128)
  # Warm overhead LED sources illuminate the three-dimensional product.
  cylinder(f'Product_Niche_{idx:02d}_Spot',.022,.041,[cx,cy+.365,-4.175],'black_trim','y',24,64)
  for dx2 in [-.09,.09]:emitters.append(dict(point=np.array([cx+dx2,cy+.345,-4.11]),normal=np.array([0,-1.,-.10]),power=np.array([.45,.34,.18])))
  for a in np.linspace(0,2*math.pi,4,endpoint=False):emitters.append(dict(point=np.array([cx+(R-.055)*math.cos(a),cy+(R-.055)*math.sin(a),-4.07]),normal=np.array([0,0,-1.]),power=np.array([.055,.04,.023])))
# Licensed detailed mesh geometry, adapted to six Nike-style concept colorways.
raw=np.load(WORK/'assets/shoe_geometry.npz');sv=raw['v'].astype(float);sf=raw['f'].astype(int);sn=raw['n'].astype(float)
shoe_ray=RayMeshIntersector(trimesh.Trimesh(sv,sf,process=False))
cent=sv[sf].mean(1);sole=cent[:,1]<(-.335+.09*np.clip((cent[:,0]-.35)/.65,0,1))
# Keep bright lace detail on the actual lace-shaped geometry at the instep.
laces=(cent[:,0]>-.65)&(cent[:,0]<.30)&(cent[:,1]>.055)&(np.abs(cent[:,2])<.145)
# A curved swoosh is an independent raised mesh on both sides of each shoe.
def bez(a,b,c,d,n=18):
 t=np.linspace(0,1,n,endpoint=False)[:,None];return (1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d
path=np.vstack([bez(np.array([.08,.68]),np.array([-.10,.24]),np.array([.13,-.02]),np.array([.43,.12])),np.array([[1.,.72],[.40,.35]]),bez(np.array([.40,.35]),np.array([.15,.23]),np.array([.06,.42]),np.array([.08,.68]))])
xy=np.column_stack([-.70+1.35*path[:,0],-.265+.245*path[:,1]])
lf=mapbox_earcut.triangulate_float64(xy,np.array([len(xy)],np.uint32)).reshape(-1,3)
logos=[]
for sign in [1,-1]:
 origins=np.column_stack([xy,np.full(len(xy),sign*.8)]);directions=np.tile([0,0,-sign],(len(xy),1));hit,rayid,faceid=shoe_ray.intersects_location(origins,directions,multiple_hits=False)
 zv=np.full(len(xy),sign*.29);zv[rayid]=hit[:,2]+sign*.008
 v=np.column_stack([xy,zv]);faces=lf if sign>0 else lf[:,::-1];logos.append(trimesh.Trimesh(v,faces,process=False))
logo=combine(logos)
shoe_colors=['shoe_white','shoe_black','shoe_red','shoe_blue','shoe_olive','shoe_sand'];shoe_report=[]
for idx,(cx,cy,cz) in enumerate(pod_locations,1):
 scale=.225 # 450 mm display model: enlarged product-study geometry for legibility.
 yaw=[.10,-.08,.12,-.10,.08,-.04][idx-1]
 t=transform([cx,cy-.11+.011-sv[:,1].min()*scale,-4.17],[0,1,0],yaw);t[:3,:3]*=scale
 for part,mask,mat in [('Upper',~sole&~laces,shoe_colors[idx-1]),('Sole',sole|laces,'shoe_sole')]:
  verts=sv[sf[mask]].reshape(-1,3);normals=sn[sf[mask]].reshape(-1,3);rot=t[:3,:3]/scale
  v=trimesh.transform_points(verts,t);n=normals@rot.T;n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-9)
  objects.append(dict(name=f'Nike_Shoe_{idx:02d}_{part}',v=v,n=n,f=np.arange(len(v)).reshape(-1,3),material=mat,extras={'role':'shoe_product','product_index':idx,'concept_colorway':shoe_colors[idx-1],'display_length_m':.45},bake_res=128))
 add(f'Nike_Shoe_{idx:02d}_Swoosh',logo,'logo_black' if idx in [1,6] else 'logo_white',t,bake_res=96,extras={'product_index':idx,'role':'shoe_brand_mark'})
 shoe_report.append({'index':idx,'center_m':[cx,cy,-4.17],'display_length_m':.45,'colorway':shoe_colors[idx-1].removeprefix('shoe_')})
# 55-inch kiosk directly ahead of the left showcase. 50 degrees above horizontal.
diag=55*.0254;KW=diag*16/math.sqrt(337);KH=diag*9/math.sqrt(337);KZ=-1.85
add('Kiosk_Base',slab(1.12,.66,.11,.10,.016),'kiosk_pearl',transform([LX,.05,KZ],[1,0,0],-math.pi/2),bake_res=256)
add('Kiosk_Pedestal_Shell',slab(.89,.90,.12,.34,.018),'kiosk_pearl',transform([LX,.55,KZ]),bake_res=256)
add('Kiosk_Pedestal_Front',slab(.805,.84,.10,.022,.006),'graphite',transform([LX,.555,KZ+.183]),bake_res=256)
rx=-math.radians(40);kt=transform([LX,1.22,KZ],[1,0,0],rx);kn=kt[:3,2]
support=[]
for x in [-.25,.25]:
 for z in [-.12,.12]:support.extend([[x,.93,z],[x,1.22-(.05-.004)/kn[1]-(kn[2]/kn[1])*z,z]])
add('Kiosk_Neck',trimesh.convex.convex_hull(np.array(support)),'black_trim',transform([LX,0,KZ]),bake_res=96)
add('Kiosk_55in_Housing',slab(KW+.13,KH+.13,.058,.10,.014),'kiosk_pearl',kt,bake_res=256)
gt=kt.copy();gt[:3,3]+=kn*.052
add('Kiosk_Screen_Bezel',slab(KW+.018,KH+.018,.012,.009,.001),'black_trim',gt,bake_res=128)
ks=kt[:3,3]+kn*.059
plane('Kiosk_Screen_55in_50deg',KW,KH,ks,'ui_kiosk',rx=rx,extras={'role':'kiosk_display','diagonal_inches':55,'tilt_degrees_from_horizontal':50,'aspect_ratio':'16:9'})
emitters.append(dict(center=ks+kn*.002,u=kt[:3,0]*KW,v=kt[:3,1]*KH,normal=kn,radiance=np.array([.25,.29,.34]),samples=4))
box('Kiosk_Service_Slot',[.22,.018,.007],[LX-.14,.58,KZ+.2],'black_trim',bake_res=64)
box('Kiosk_Red_Status_Line',[.36,.015,.006],[LX,.33,KZ+.20],'red_led',bake_res=0)
# Right experience: precise 85-inch, 16:9 wall monitor.
WD=85*.0254;WW=WD*16/math.sqrt(337);WH=WD*9/math.sqrt(337);wc=np.array([RX,2.24,-4.31])
add('Wall_Screen_85in_Frame',slab(WW+.075,WH+.075,.022,.066,.006),'black_trim',transform(wc-[0,0,.040]),bake_res=256)
plane('Wall_Screen_85in_16x9',WW,WH,wc,'ui_wall',extras={'role':'wall_display','diagonal_inches':85,'aspect_ratio':'16:9','active_width_m':WW,'active_height_m':WH})
emitters.append(dict(center=wc+[0,0,.002],u=np.array([WW,0,0]),v=np.array([0,WH,0]),normal=np.array([0,0,1]),radiance=np.array([.35,.45,.52]),samples=8))
# Reference-inspired slim horizontal multi-touch table on a substantial pedestal.
TD=75*.0254;TW=TD*16/math.sqrt(337);TH=TD*9/math.sqrt(337);TZ=-2.12;TY=.94
add('Tangible_Table_Base',slab(1.10,.78,.05,.075,.01),'table_graphite',transform([RX,.0375,TZ],[1,0,0],-math.pi/2),bake_res=192)
add('Tangible_Table_Pedestal',slab(.78,.80,.035,.46,.01),'table_graphite',transform([RX,.475,TZ]),bake_res=256)
add('Tangible_Table_Top',slab(TW+.12,TH+.12,.032,.075,.008),'table_graphite',transform([RX,TY-.044,TZ],[1,0,0],-math.pi/2),bake_res=256)
plane('Tangible_Table_75in_Touch_Surface',TW,TH,[RX,TY,TZ],'ui_table',rx=-math.pi/2,extras={'role':'touch_table_surface','diagonal_inches':75,'surface_height_m':TY,'aspect_ratio':'16:9'})
emitters.append(dict(center=np.array([RX,TY+.003,TZ]),u=np.array([TW,0,0]),v=np.array([0,0,-TH]),normal=np.array([0,1,0]),radiance=np.array([.18,.32,.37]),samples=8))
# Three physical tokens and glowing recognition rings make tangibility legible.
for idx,(dx,dz) in enumerate([(-.51,.10),(.03,-.19),(.51,.15)],1):
 cylinder(f'Tangible_Puck_{idx:02d}',.065,.034,[RX+dx,TY+.017,TZ+dz],'silver','y',48,96)
 mesh=annulus_mesh(.09,.083,.004,48);add(f'Tangible_Puck_{idx:02d}_Recognition_Ring',mesh,'cyan_led',transform([RX+dx,TY+.003,TZ+dz],[1,0,0],-math.pi/2),bake_res=0)
 if idx==1:cylinder('Tangible_Token_Cylinder',.024,.05,[RX+dx,TY+.060,TZ+dz],'red_metal','y',32,96)
 elif idx==2:
  box('Tangible_Token_Cube',[.04,.046,.04],[RX+dx,TY+.057,TZ+dz],'champagne',bake_res=64)
 else:
  sphere=trimesh.creation.icosphere(subdivisions=2,radius=.026);add('Tangible_Token_Sphere',sphere,'silver',transform([RX+dx,TY+.060,TZ+dz]),bake_res=96)
# Architectural task lights supplement the original ceiling diffuser and cove.
for label,cx in [('Product',LX),('Tangible',RX)]:
 box(label+'_Ceiling_Light_Housing',[2.9,.065,.16],[cx,3.65,-2.9],'black_trim',bake_res=128)
 for sx in [-1,1]:box(label+('_Light_Suspension_L' if sx<0 else '_Light_Suspension_R'),[.012,.60,.012],[cx+sx*1.1,3.965,-2.9],'black_trim',bake_res=64)
 plane(label+'_Task_Light',2.78,.09,[cx,3.615,-2.9],'warm_led',rx=math.pi/2)
 emitters.append(dict(center=np.array([cx,3.61,-2.9]),u=np.array([2.78,0,0]),v=np.array([0,0,.09]),normal=np.array([0,-1,0]),radiance=np.array([8.,6.5,4.8]),samples=8))
 # Broad wall wash from a discrete roof-mounted source, paired with task housing.
 for dx in [-1.,0.,1.]:emitters.append(dict(point=np.array([cx+dx,3.62,-2.91]),normal=np.array([0,-.30,-.954]),power=np.array([4.8,3.7,2.65])))
# Soft ceiling fill towards each experience, to reveal dark table and wall finishes.
for label,cx in [('Product',LX),('Tangible',RX)]:
 normal=np.array([0.,-.82,-.57236352]);normal/=np.linalg.norm(normal)
 # Rotate a rectangular emitter from +Z to its downward/front-facing normal.
 angle=math.atan2(-normal[1],normal[2]);center=np.array([cx,3.97,.85])
 tfill=transform(center,[1,0,0],angle)
 add(label+'_Fill_Light_Housing',slab(2.88,.15,.035,.035,.004),'black_trim',tfill,bake_res=128)
 materials['fill_led']=dict(base=[.01,.01,.01],metal=0,rough=.5,coat=0,emission=[130.,145.,165.])
 front=center+normal*.020
 plane(label+'_Fill_Light',2.78,.10,front,'fill_led',rx=angle)
 emitters.append(dict(center=front+normal*.004,u=tfill[:3,0]*2.78,v=tfill[:3,1]*.10,normal=normal,radiance=np.array([130.,145.,165.]),samples=12))
report={'project':'White Tusker product showcase and tangible experience room','units':'meters','clear_room_dimensions_ft':[50,30,14],'clear_room_dimensions_m':[W,D,H], 'experiences':{'left':{'name':'Nike product showcase','center_x_m':LX,'niche_layout':'3 columns x 2 rows','shoe_count':6,'niche_diameter_m':R*2,'shoes':shoe_report},'right':{'name':'Tangible multi-touch table','center_x_m':RX,'wall_screen_diagonal_in':85,'wall_screen_aspect':'16:9','wall_screen_active_size_m':[WW,WH],'table_diagonal_in':75,'table_active_size_m':[TW,TH],'table_surface_height_m':TY,'tangible_pucks':3}},'kiosk':{'diagonal_inches':55,'active_size_m':[KW,KH],'tilt_degrees_from_horizontal':50,'plan_center_m':[LX,KZ]},'materials':'Original metallic red, glossy graphite, warm cove and circular diffuser retained; warm gold added only to reference-inspired product niches.','model_notes':'Nike-branded concept display colorways, not exact Nike retail SKUs. Each sneaker is an enlarged 450 mm study model to improve showcase legibility. Tangible interface graphics are illustrative; hardware does not operate inside a static GLB.','shoe_geometry_credit':'Adapted from Materials Variants Shoe, © 2021 Shopify, CC BY 4.0, distributed by KhronosGroup/glTF-Sample-Assets. Original textures replaced with custom colorways and raised Nike-style swoosh marks.','shoe_geometry_source':'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MaterialsVariantsShoe','license':'https://creativecommons.org/licenses/by/4.0/'}
pickle.dump(dict(objects=objects,materials=materials,emitters=emitters,report=report),open(WORK/'scene.pkl','wb'));(OUT/'Dimensions_and_Materials.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'meshes':len(objects),'triangles':sum(len(o['f']) for o in objects),'shoe_products':len(shoe_report),'room_m':[W,D,H],'wall_screen_m':[WW,WH]}),flush=True)
