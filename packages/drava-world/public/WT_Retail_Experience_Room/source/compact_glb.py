"""Compact the GLB buffers and weld coincident vertices to 1-micron tolerance."""
from pathlib import Path
import numpy as np,json,struct,copy
OUT=Path(__file__).resolve().parent.parent
path=OUT/'WT_Retail_Experience_Room.glb';data=path.read_bytes();jslen=struct.unpack_from('<I',data,12)[0];j=json.loads(data[20:20+jslen]);raw=data[28+jslen:]
oldviews=j['bufferViews'];oldaccess=j['accessors'];binary=bytearray();j['bufferViews']=[];j['accessors']=[]
DT={5126:np.dtype('<f4'),5125:np.dtype('<u4'),5123:np.dtype('<u2')};NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def read(i):
 a=oldaccess[i];v=oldviews[a['bufferView']];assert 'byteStride' not in v
 return np.frombuffer(raw,DT[a['componentType']],count=a['count']*NC[a['type']],offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],NC[a['type']])
def view(b,target=None):
 binary.extend(b'\0'*((-len(binary))%4));v={'buffer':0,'byteOffset':len(binary),'byteLength':len(b)};binary.extend(b)
 if target:v['target']=target
 j['bufferViews'].append(v);return len(j['bufferViews'])-1
def acc(a,kind,comp=5126):
 a=np.asarray(a,dtype=DT[comp]);q={'bufferView':view(a.tobytes(),34963 if kind=='SCALAR' else 34962),'componentType':comp,'count':len(a),'type':kind}
 if kind=='VEC3':q.update(min=a.min(0).tolist(),max=a.max(0).tolist())
 j['accessors'].append(q);return len(j['accessors'])-1
for im in j['images']:
 v=oldviews[im['bufferView']];im['bufferView']=view(raw[v['byteOffset']:v['byteOffset']+v['byteLength']])
before=after=0
for mesh in j['meshes']:
 for p in mesh['primitives']:
  arrays={name:read(i) for name,i in p['attributes'].items()};indices=read(p['indices']).ravel();matrix=np.concatenate(list(arrays.values()),axis=1)
  _,first,remap=np.unique(np.round(matrix,6),axis=0,return_index=True,return_inverse=True);before+=len(matrix);after+=len(first)
  for name,i in list(p['attributes'].items()):p['attributes'][name]=acc(arrays[name][first],oldaccess[i]['type'])
  p['indices']=acc(remap[indices],'SCALAR',5123 if len(first)<65536 else 5125)
j['buffers']=[{'byteLength':len(binary)}];binary.extend(b'\0'*((-len(binary))%4))
j['extras']['web_optimization']={'vertices_before':before,'vertices_after':after,'weld_tolerance_m':.000001,'notes':'Coincident attributes welded to 1e-6 tolerance. Shoe micro-normal maps removed; detailed geometry normals and baked material shading retained. No geometry decimation.'}
def write(path,doc):
 t=json.dumps(doc,separators=(',',':')).encode();t+=b' '*((-len(t))%4)
 b=struct.pack('<III',0x46546c67,2,28+len(t)+len(binary))+struct.pack('<II',len(t),0x4e4f534a)+t+struct.pack('<II',len(binary),0x004e4942)+binary;path.write_bytes(b);return len(b)
size=write(path,j);cut=copy.deepcopy(j);hidden=('Ceiling_','Warm_Perimeter','Wall_Rear','Entry_Header','Product_Ceiling_Light','Product_Light_Suspension','Product_Task_Light','Product_Fill_Light','Tangible_Ceiling_Light','Tangible_Light_Suspension','Tangible_Task_Light','Tangible_Fill_Light');cut['scenes'][0]['nodes']=[i for i in cut['scenes'][0]['nodes'] if not cut['nodes'][i]['name'].startswith(hidden)];cut['scenes'][0]['name']='Cutaway inspection variant — roof and rear wall hidden';write(OUT/'WT_Retail_Experience_Room_Cutaway.glb',cut)
report=json.loads((OUT/'Bake_Report.json').read_text());report.update(optimized_output_bytes=size,vertices_before=before,vertices_after=after);(OUT/'Bake_Report.json').write_text(json.dumps(report,indent=2));print(json.dumps({'before_bytes':len(data),'after_bytes':size,'vertices_before':before,'vertices_after':after}))
