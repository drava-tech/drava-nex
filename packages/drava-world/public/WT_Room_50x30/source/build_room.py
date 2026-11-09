"""Dimensioned White Tusker four-screen room, meters, Y up."""
from pathlib import Path
import numpy as np
import trimesh,json,struct,pickle,math
SOURCE=Path(__file__).resolve().parent;ROOT=SOURCE.parent;WORK=ROOT/'_cache';OUT=ROOT
WORK.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
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

# The four large wall screens share identical 16 ft x 9 ft active areas.
SW,SH=16*FT,9*FT;screen_y=2*FT+SH/2
screen_specs=[('Screen_Front_Left',[-10*FT,screen_y,-D/2+.15],0),('Screen_Front_Right',[10*FT,screen_y,-D/2+.15],0),('Screen_Left',[-W/2+.15,screen_y,0],math.pi/2),('Screen_Right',[W/2-.15,screen_y,0],-math.pi/2)]
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

# 55-inch landscape kiosk at the exact centre of the clear room.
diag=55*.0254;KW=diag*16/math.sqrt(337);KH=diag*9/math.sqrt(337)
add('Kiosk_Base',slab(1.12,.66,.11,.10,.016),'kiosk_pearl',transform([0,.05,0],[1,0,0],-math.pi/2),bake_res=256)
add('Kiosk_Pedestal_Shell',slab(.89,.99,.12,.34,.018),'kiosk_pearl',transform([0,.595,0]),bake_res=256)
add('Kiosk_Pedestal_Front',slab(.805,.925,.10,.022,.006),'graphite',transform([0,.61,.183]),bake_res=256)
# Wedge-shaped support meets the underside of the 45-degree housing without
# penetrating the active screen. Its upper plane follows y + z = constant.
support=[]
for x in [-.25,.25]:
 for z in [-.12,.12]:
  support.extend([[x,1.0,z],[x,1.20-.05*math.sqrt(2)+.005-z,z]])
add('Kiosk_Neck',trimesh.convex.convex_hull(np.array(support)),'black_trim',bake_res=128)
panel_t=transform([0,1.20,0],[1,0,0],-math.pi/4)
add('Kiosk_55in_Housing',slab(KW+.13,KH+.13,.058,.10,.014),'kiosk_pearl',panel_t,extras={'tilt_degrees_from_horizontal':45},bake_res=384)
glass_t=panel_t.copy();glass_t[:3,3]+=panel_t[:3,2]*.052
add('Kiosk_Screen_Bezel',slab(KW+.018,KH+.018,.012,.009,.001),'black_trim',glass_t,bake_res=128)
center=panel_t[:3,3]+panel_t[:3,2]*.059
ko,kt=plane('Kiosk_Screen_55in_45deg',KW,KH,center,'kiosk_screen',rx=-math.pi/4,extras={'role':'kiosk_display','diagonal_inches':55,'aspect_ratio':'16:9','tilt_degrees_from_horizontal':45,'active_width_m':KW,'active_height_m':KH})
emitters.append(dict(center=center+kt[:3,2]*.003,u=kt[:3,0]*KW,v=kt[:3,1]*KH,normal=kt[:3,2],radiance=np.array([.75,.82,.88]),samples=4))
# Reference-inspired small dark service slot on the pedestal.
box('Kiosk_Service_Slot',[.22,.018,.007],[-.14,.64,.20],'black_trim',bake_res=128)

# Reuse the user's original extruded White Tusker logo, centred between screens.
logo=np.load(SOURCE/'assets/white_tusker_logo.npz');v=logo['vertices'].copy();f=logo['faces'].copy();v-=np.mean([v.min(0),v.max(0)],0);scale=1.01/np.ptp(v[:,2]);v*=scale
add('White_Tusker_Logo',trimesh.Trimesh(v,f,process=False),'silver',transform([0,2.12,-D/2+.10],[0,1,0],-math.pi/2),bake_res=384)

report={'project':'White Tusker 50 x 30 four-screen room','units':'meters','clear_room_dimensions_ft':[50,30,14],'clear_room_dimensions_m':[W,D,H],'wall_thickness_m':.15,'wall_screens':screen_report,'wall_display_count':4,'kiosk':{'center_plan_m':[0,0],'active_diagonal_in':55,'active_width_m':KW,'active_height_m':KH,'tilt_from_horizontal_deg':45,'active_surface_center_m':center.tolist(),'housing_height_range_m':[float(objects[-4]['v'][:,1].min()),float(objects[-4]['v'][:,1].max())]},'rear_entry_clear_width_ft':8,'rear_entry_clear_height_ft':9,'ceiling_disc_diameter_ft':20,'layout_notes':'Front wall spans the 50 ft width; left and right walls span the 30 ft depth. Rear entry added as a practical access opening. Floating ceiling fixtures sit below the 14 ft shell height.','material_reference':'02-1001069430.jpg and previously approved WTZ1 glossy finish','kiosk_reference':'01-1001069645.jpg; geometry adapted to a true 55-inch 16:9 panel.'}
report['kiosk']['housing_height_range_m']=[float(next(o for o in objects if o['name']=='Kiosk_55in_Housing')['v'][:,1].min()),float(next(o for o in objects if o['name']=='Kiosk_55in_Housing')['v'][:,1].max())]
pickle.dump(dict(objects=objects,materials=materials,emitters=emitters,report=report),open(WORK/'scene.pkl','wb'))
(OUT/'Dimensions_and_Materials.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'objects':len(objects),'triangles':sum(len(o['f']) for o in objects),'room_m':[W,D,H],'kiosk_active_mm':[KW*1000,KH*1000]}),flush=True)
