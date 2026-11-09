"""Dimensioned White Tusker dual-screen room, meters, Y up."""
from pathlib import Path
import numpy as np
import trimesh,json,struct,pickle,math
WORK=Path(__file__).resolve().parent;OUT=WORK.parent;ROOT=OUT
FT=.3048;W,D,H=np.array([40,30,14])*FT
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

# All shell thickness is outside the specified clear room dimensions.
box('Floor',[W+.30,.12,D+.30],[0,-.06,0],'floor',bake_res=768)
box('Wall_Front',[W,H,.15],[0,H/2,-D/2-.075],'graphite',bake_res=512)
box('Wall_Left',[.15,H,D+.30],[-W/2-.075,H/2,0],'graphite',bake_res=512)
box('Wall_Right',[.15,H,D+.30],[W/2+.075,H/2,0],'graphite',bake_res=512)
opening=8*FT;door_h=9*FT;flank=(W-opening)/2
for sign,side in [(-1,'Left'),(1,'Right')]:box('Wall_Rear_'+side,[flank,.0+H,.15],[sign*(opening/2+flank/2),H/2,D/2+.075],'graphite',bake_res=384)
box('Entry_Header',[opening,H-door_h,.15],[0,door_h+(H-door_h)/2,D/2+.075],'graphite',bake_res=256)
box('Ceiling_Shell',[W+.3,.12,D+.3],[0,H+.06,0],'ceiling',bake_res=512)
add('Ceiling_Inset',slab(W-.48,D-.48,.36,.075,.008),'ceiling',transform([0,H-.070,0],[1,0,0],-math.pi/2),bake_res=512)
# Red front and left wall panels retain the original colour arrangement.
panel_bottom=.40;panel_top=3.70;ph=panel_top-panel_bottom
box('Red_Front_Panel',[W-.42,ph,.045],[0,(panel_top+panel_bottom)/2,-D/2+.0275],'red_metal',bake_res=768)
box('Red_Left_Panel',[.045,ph,D-.42],[-W/2+.0275,(panel_top+panel_bottom)/2,0],'red_metal',bake_res=512)
# Dark shadow gap / skirting at floor level.
box('Front_Skirting',[W,.18,.035],[0,.09,-D/2+.020],'black_trim',bake_res=128)
box('Left_Skirting',[.035,.18,D],[-W/2+.020,.09,0],'black_trim',bake_res=128)
box('Right_Skirting',[.035,.18,D],[W/2-.020,.09,0],'black_trim',bake_res=128)

# Two distinct front displays, each with a 16 ft x 9 ft active area.
SW,SH=16*FT,9*FT;screen_y=2*FT+SH/2
screen_specs=[('Screen_Front_Left',[-9.5*FT,screen_y,-D/2+.15],0),('Screen_Front_Right',[9.5*FT,screen_y,-D/2+.15],0)]
screen_report=[]
for name,center,angle in screen_specs:
 t=transform(center,[0,1,0],angle);normal=t[:3,2]
 add(name+'_Frame',slab(SW+.10,SH+.10,.035,.085,.009),'black_trim',transform(np.array(center)-normal*.053,[0,1,0],angle),bake_res=256)
 o,tt=plane(name,SW,SH,center,'white_screen',ry=angle,extras={'role':'wall_display','aspect_ratio':'16:9','active_width_m':SW,'active_height_m':SH})
 screen_report.append({'name':name,'active_width_ft':16,'active_height_ft':9,'active_width_m':SW,'active_height_m':SH,'center_m':center,'normal':normal.tolist()})
 emitters.append(dict(center=np.array(center)+normal*.002,u=t[:3,0]*SW,v=t[:3,1]*SH,normal=normal,radiance=np.array([2.2,2.28,2.36]),samples=8))

# Circular ceiling diffuser with a slim dark mounting rim.
disc_d=20*FT;disc_y=H-.19
c=trimesh.creation.cylinder(radius=disc_d/2+.025,height=.065,sections=96);add('Ceiling_Disc_Rim',c,'black_trim',transform([0,disc_y+.03,0],[1,0,0],math.pi/2),bake_res=256)
xy=np.array([[0,0]]+[[disc_d/2*math.cos(a),disc_d/2*math.sin(a)] for a in np.linspace(0,2*math.pi,97)[:-1]])
verts=np.column_stack([xy,np.zeros(len(xy))]);faces=[[0,i+1,(i+1)%96+1] for i in range(96)]
add('Ceiling_Disc_Light',trimesh.Trimesh(verts,faces,process=False),'disc_light',transform([0,disc_y-.004,0],[1,0,0],math.pi/2),bake_res=0)
for i in range(20):
 r=disc_d/2*math.sqrt((i+.5)/20);a=i*2.3999632297
 emitters.append(dict(point=np.array([r*math.cos(a),disc_y-.008,r*math.sin(a)]),normal=np.array([0,-1,0]),power=np.array([2.5,2.25,2.0])*(math.pi*(disc_d/2)**2/20)))

# Continuous rounded rectangular warm cove, visible as one uninterrupted line.
outer=rounded_loop(W-.38,D-.38,.40,14);inner=rounded_loop(W-.48,D-.48,.35,14);n=len(outer);y=H-.11
verts=np.vstack([np.column_stack([outer[:,0],np.full(n,y),outer[:,1]]),np.column_stack([inner[:,0],np.full(n,y),inner[:,1]])]);faces=[]
for i in range(n):
 k=(i+1)%n;faces.extend([[i,k,n+k],[i,n+k,n+i]])
# Orient all cove faces downwards.
mesh=trimesh.Trimesh(verts,faces,process=False)
if mesh.face_normals[0,1]>0:mesh.invert()
add('Warm_Perimeter_Cove',mesh,'cove_light',bake_res=0)
for k in range(0,n,2):
 nxt=(k+2)%n;center=(outer[k]+outer[nxt])/2
 emitters.append(dict(point=np.array([center[0],y-.025,center[1]]),normal=np.array([0,-1,0]),power=np.array([3.,1.8,1.1])*np.linalg.norm(outer[nxt]-outer[k])*.07))

# Existing White Tusker mark, scaled to fit the three-foot central reveal.
a=np.load(WORK/'assets/white_tusker_logo.npz');v=a['v']+[0,2.12,-D/2+.095]
objects.append(dict(name='White_Tusker_Logo',v=v,n=a['n'],f=a['f'],material='silver',extras={'role':'brand_mark'},bake_res=256))
report={'project':'White Tusker 40 x 30 dual-screen room','units':'meters','clear_room_dimensions_ft':[40,30,14],'clear_room_dimensions_m':[W,D,H],'wall_thickness_m':.15,'wall_screens':screen_report,'wall_display_count':2,'screen_gap_ft':3,'screen_end_margins_ft':2.5,'screen_bottom_ft':2,'screen_top_ft':11,'rear_entry_clear_width_ft':8,'rear_entry_clear_height_ft':9,'ceiling_disc_diameter_ft':20,'layout_notes':'Two separate 16:9 screens on the 40-foot front wall. Red front and left wall panels, metallic graphite shell and floor, rounded warm cove and circular ceiling diffuser retained from the approved room family. Clear room height is measured to the structural ceiling; the decorative inset and lighting sit below it.','finish':'Same material values and architectural micro-normal/roughness textures as the preceding rooms.'}
pickle.dump(dict(objects=objects,materials=materials,emitters=emitters,report=report),open(WORK/'scene.pkl','wb'))
(OUT/'Dimensions_and_Materials.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'meshes':len(objects),'triangles':sum(len(o['f']) for o in objects),'room_m':[W,D,H],'screen_active_m':[SW,SH]}),flush=True)
