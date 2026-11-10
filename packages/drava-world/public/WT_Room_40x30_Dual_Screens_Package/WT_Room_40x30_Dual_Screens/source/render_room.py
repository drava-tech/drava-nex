"""CPU GGX previews of the actual exported room geometry and baked materials."""
import pickle,math,sys
from pathlib import Path
import numpy as np,trimesh
from PIL import Image
from scipy.ndimage import gaussian_filter
from trimesh.ray.ray_pyembree import RayMeshIntersector
WORK=Path(__file__).resolve().parent;OUT=WORK.parent;ROOT=OUT
s=pickle.load(open(WORK/'baked_scene.pkl','rb'));objs=s['objects'];mats=s['materials'];V=s['geometry']['V'];F=s['geometry']['F'];FO=s['geometry']['FO'];UV=s['geometry']['UV'];N=np.concatenate([o['n'] for o in objs]);tri=V[F]
def norm(v):return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-10)
fn=norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]));ray=RayMeshIntersector(trimesh.Trimesh(V,F,process=False));base=np.array([mats[o['material']]['base'] for o in objs]);metal=np.array([mats[o['material']]['metal'] for o in objs]);rough=np.array([mats[o['material']]['rough']*.93 for o in objs]);coat=np.array([mats[o['material']]['coat'] for o in objs]);emissive=np.array(['emission' in mats[o['material']] for o in objs])
def samples(pos,ids):
 bc=trimesh.triangles.points_to_barycentric(tri[ids],pos);uv=(UV[F[ids]]*bc[:,:,None]).sum(1);out=np.zeros((len(ids),3))
 for oi,o in enumerate(objs):
  mask=FO[ids]==oi
  if not mask.any():continue
  im=o['radiance']
  if im.ndim==1:out[mask]=im
  else:
   h,w=im.shape[:2];coords=uv[mask];out[mask]=im[np.clip((coords[:,1]*h).astype(int),0,h-1),np.clip((coords[:,0]*w).astype(int),0,w-1)]
 return out,bc
def points(orig,d,ids):
 valid=ids>=0;q=ids[valid];den=np.sum(d[valid]*fn[q],1);dist=np.sum((tri[q,0]-orig[valid])*fn[q],1)/np.where(abs(den)<1e-10,1e-10,den)
 return valid,orig[valid]+d[valid]*dist[:,None]
def incoming(p,d):
 ids=ray.intersects_first(p,d);valid,pos=points(p,d,ids);rgb=np.tile([.006,.007,.009],(len(p),1))
 if valid.any():rgb[valid]=samples(pos,ids[valid])[0]
 return rgb
def aces(c):
 c=c*(1.05/.6);c=c@np.array([[.59719,.076,.0284],[.35458,.90834,.13383],[.04823,.01566,.83777]])
 c=(c*(c+.0245786)-.000090537)/(c*(.983729*c+.432951)+.238081);c=c@np.array([[1.60475,-.10208,-.00327],[-.53108,1.10813,-.07276],[-.07367,-.00605,1.07602]])
 c=np.clip(c,0,1);return np.where(c<=.0031308,c*12.92,1.055*c**(1/2.4)-.055)
views={
 'Interior':dict(eye=[0,1.85,4.1],target=[0,1.95,-4.0],fov=62,w=1400,h=788,spp=96,cut=False),
 'Overview':dict(eye=[0,11.8,13.4],target=[0,1.2,-.35],fov=45,w=1200,h=900,spp=96,cut=True),
}
name=sys.argv[1] if len(sys.argv)>1 else 'Interior';v=views[name].copy()
if len(sys.argv)>2:v.update(w=v['w']//2,h=v['h']//2,spp=16)
w,h=v['w'],v['h'];eye=np.array(v['eye']);forward=norm(np.array(v['target'])-eye);right=norm(np.cross(forward,[0,1,0]));up=np.cross(right,forward);yy,xx=np.mgrid[:h,:w];sx=((xx+.5)/w*2-1)*math.tan(math.radians(v['fov'])/2)*w/h;sy=(1-(yy+.5)/h*2)*math.tan(math.radians(v['fov'])/2)
d=norm((forward+sx[:,:,None]*right+sy[:,:,None]*up).reshape(-1,3));orig=np.tile(eye,(len(d),1));active=np.ones(len(F),bool)
if v['cut']:active=~np.array([objs[i]['name'].startswith(('Ceiling_','Warm_Perimeter','Wall_Rear','Entry_Header')) for i in FO])
face_ids=np.flatnonzero(active);camera_ray=RayMeshIntersector(trimesh.Trimesh(V,F[active],process=False));ids=camera_ray.intersects_first(orig,d);ids=np.where(ids>=0,face_ids[np.maximum(ids,0)],-1);valid,p=points(orig,d,ids);ids=ids[valid];mi=FO[ids];rgb,bc=samples(p,ids)
n=norm((N[F[ids]]*bc[:,:,None]).sum(1));view=-d[valid];n[np.sum(n*view,axis=1)<0]*=-1;live=~emissive[mi]
indices=np.flatnonzero(live);pp=p[live]+n[live]*.002;nn=n[live];vv=view[live];material=mi[live];nv=np.maximum(.001,np.sum(nn*vv,1));alpha=rough[material]**2;mm=metal[material,None];f0=base[material]*mm+.04*(1-mm)
ref=np.tile([0.,1.,0.],(len(nn),1));ref[abs(nn[:,1])>.95]=[1,0,0];t=norm(np.cross(ref,nn));bit=np.cross(nn,t);spec=np.zeros_like(pp);spp=v['spp'];rng=np.random.default_rng(21);shift=rng.random(len(nn))
for i in range(spp):
 u=(i+.5)/spp;phi=(i*2.3999632297+shift*2*math.pi);cos=np.sqrt((1-u)/(1+(alpha*alpha-1)*u));sin=np.sqrt(1-cos*cos);half=norm(t*(sin*np.cos(phi))[:,None]+bit*(sin*np.sin(phi))[:,None]+nn*cos[:,None]);vh=np.maximum(np.sum(vv*half,1),0);ld=norm(2*vh[:,None]*half-vv);nl=np.maximum(0,np.sum(nn*ld,1));g1=2*nv/(nv+np.sqrt(alpha**2+(1-alpha**2)*nv**2));g2=2*nl/np.maximum(nl+np.sqrt(alpha**2+(1-alpha**2)*nl**2),1e-9);weight=g1*g2*vh/np.maximum(nv*cos,1e-9);fresnel=f0+(1-f0)*(1-vh[:,None])**5
 spec+=incoming(pp,ld)*fresnel*weight[:,None]/spp
 if i%16==0:print(name,'GGX samples',i,'/',spp,flush=True)
# A modest dielectric coat, evaluated as a second softer reflection lobe.
reflection=norm(2*nv[:,None]*nn-vv);clear=incoming(pp,reflection)*(.04+.96*(1-nv[:,None])**5)*coat[material,None]*.22
rgb[live]+=spec+clear
out=np.tile([.012,.014,.018],(len(d),1));out[valid]=rgb;out=aces(out.reshape(h,w,3));out=gaussian_filter(out,(.45,.45,0));Image.fromarray(np.uint8(np.clip(out*255,0,255))).save(OUT/f'WT_Room_40x30_Dual_Screens_{name}.png');print('Saved',name,flush=True)
