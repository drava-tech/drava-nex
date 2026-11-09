/**
 * Regenerates the WARPS coefficients in world-clock/mapWarp.js: fits a per-region
 * quadratic warp from (lon / 100, mercatorY(lat)) to world-clock/assets/world_map.glb's
 * flat x/z plane by trimmed ICP between Natural Earth coastlines
 * (world-atlas) and the GLB's coastline. Progress goes to stderr; the
 * coefficients (model units) to stdout.
 *
 *   node scripts/fit-map-warp.cjs
 */
// Fits a per-region quadratic warp (lon, mercY) -> model raster (u, v) by trimmed ICP between
// reference coastlines and the GLB's coastline. Prints coefficients as JSON.
const path=require("path");const fs=require("fs");
function readGlb(path){
  const b=fs.readFileSync(path);const jl=b.readUInt32LE(12);const j=JSON.parse(b.slice(20,20+jl).toString());
  const binStart=20+jl+8;const bin=b.slice(binStart);
  const acc=(i)=>{const a=j.accessors[i];const bv=j.bufferViews[a.bufferView];const off=(bv.byteOffset||0)+(a.byteOffset||0);
    const n={SCALAR:1,VEC2:2,VEC3:3}[a.type];const T={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];
    const stride=bv.byteStride||n*T.BYTES_PER_ELEMENT;const out=new T(a.count*n);
    for(let k=0;k<a.count;k++)for(let c=0;c<n;c++)out[k*n+c]=new T(bin.buffer.slice(bin.byteOffset+off+k*stride+c*T.BYTES_PER_ELEMENT,bin.byteOffset+off+k*stride+(c+1)*T.BYTES_PER_ELEMENT))[0];
    return out;};
  return {j,acc};
}

const fs=require("fs");
const root=path.resolve(__dirname,"..");
const {j,acc}=readGlb(path.join(root,"world-clock/assets/world_map.glb"));
const m=j.meshes[1].primitives[0];const P=acc(m.attributes.POSITION),I=acc(m.indices);
const minx=-6297.2,maxx=6910.4,minz=-2806.0,maxz=3893.2;
const W=1400,H=Math.round(W*(maxz-minz)/(maxx-minx));const model=new Uint8Array(W*H);
for(let t=0;t<I.length;t+=3){const v=[0,1,2].map(k=>[(P[I[t+k]*3]-minx)/(maxx-minx)*W,(P[I[t+k]*3+2]-minz)/(maxz-minz)*H]);
 const x0=Math.max(0,Math.floor(Math.min(...v.map(q=>q[0])))),x1=Math.min(W-1,Math.ceil(Math.max(...v.map(q=>q[0]))));
 const y0=Math.max(0,Math.floor(Math.min(...v.map(q=>q[1])))),y1=Math.min(H-1,Math.ceil(Math.max(...v.map(q=>q[1]))));
 const s=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const p=[x+.5,y+.5];const d1=s(v[0],v[1],p),d2=s(v[1],v[2],p),d3=s(v[2],v[0],p);if(!((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0)))model[y*W+x]=1;}}
// model coastline pixels + nearest-edge map via multi-source BFS
const near=new Int32Array(W*H).fill(-1);const q=[];
for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const k=y*W+x;if(model[k]&&(!model[k-1]||!model[k+1]||!model[k-W]||!model[k+W])){near[k]=k;q.push(k);}}
for(let h=0;h<q.length;h++){const k=q[h];const x=k%W,y=(k/W)|0;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const n=ny*W+nx;if(near[n]<0){near[n]=near[k];q.push(n);}}}
const merc=l=>Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,l))*Math.PI/360));
const region=(lon,lat)=>lon< -25?"americas":(lon>110&&lat< -10)||lon>160||lon< -160&&lat<0?"oceania":"afroeurasia";
const topo=require(path.join(root,"node_modules/topojson-client"));const world=require(path.join(root,"node_modules/world-atlas/countries-110m.json"));
const pts={americas:[],afroeurasia:[],oceania:[]};
for(const f of topo.feature(world,world.objects.land).features){const g=f.geometry;for(const p of (g.type==="Polygon"?[g.coordinates]:g.coordinates))for(const r of p)for(let i=0;i<r.length-1;i++){const [x1,y1]=r[i],[x2,y2]=r[i+1];if(Math.abs(x1-x2)>180)continue;for(let t=0;t<1;t+=0.25){const lon=x1+(x2-x1)*t,lat=y1+(y2-y1)*t;if(lat< -60||lat>84)continue;pts[region(lon,lat)].push([lon/100,merc(lat)]);}}}
const feats=([x,y])=>[1,x,y,x*x,x*y,y*y];
// init from global Mercator fit (u in 0..1): u=(lon+205.5)/448 ; v=(Y-2.375)/-3.6025
const init=()=>({u:[205.5/448,100/448,0,0,0,0],v:[-2.375/-3.6025,0,1/-3.6025,0,0,0]});
function solve(A,b){// normal equations 6x6
 const n=6,M=Array.from({length:n},()=>new Float64Array(n+1));for(let r=0;r<A.length;r++){const a=A[r];for(let i=0;i<n;i++){for(let k=0;k<n;k++)M[i][k]+=a[i]*a[k];M[i][n]+=a[i]*b[r];}}
 for(let i=0;i<n;i++)M[i][i]+=1e-9;
 for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;[M[c],M[p]]=[M[p],M[c]];for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c]/M[c][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}
 return M.map((row,i)=>row[n]/row[i]);}
const out={};
for(const reg of Object.keys(pts)){let T=init();const S=pts[reg];
 for(let it=0;it<60;it++){const thr=it<15?40:it<35?20:10;const A=[],bu=[],bv=[];let err=0,cnt=0;
  for(const s of S){const f=feats(s);const u=f.reduce((a,c,i)=>a+c*T.u[i],0),v=f.reduce((a,c,i)=>a+c*T.v[i],0);const px=Math.round(u*W),py=Math.round(v*H);if(px<0||py<0||px>=W||py>=H)continue;const n=near[py*W+px];if(n<0)continue;const nx=n%W,ny=(n/W)|0;const d=Math.hypot(nx-px,ny-py);if(d>thr)continue;err+=d;cnt++;A.push(f);bu.push((nx+.5)/W);bv.push((ny+.5)/H);}
  // affine only for first iterations (zero quadratic terms), then quadratic
  const sol=(b)=>{if(it<20){const A3=A.map(a=>a.slice(0,3));const n=3,M=Array.from({length:n},()=>new Float64Array(n+1));for(let r=0;r<A3.length;r++){const a=A3[r];for(let i=0;i<n;i++){for(let k=0;k<n;k++)M[i][k]+=a[i]*a[k];M[i][n]+=a[i]*b[r];}}for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;[M[c],M[p]]=[M[p],M[c]];for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c]/M[c][c];for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k];}}return [...M.map((row,i)=>row[n]/row[i]),0,0,0];}return solve(A,b);};
  T={u:sol(bu),v:sol(bv)};
  if(it%10===9||it===59)console.error(reg,"it",it,"mean px err",(err/cnt).toFixed(2),"matched",cnt,"/",S.length);
 }
 out[reg]=T;}
// convert raster (u,v) to model units: x=minx+u*(maxx-minx), z=minz+v*(maxz-minz)
const conv={};for(const [k,T] of Object.entries(out))conv[k]={x:T.u.map((c,i)=>c*(maxx-minx)+(i===0?minx:0)),z:T.v.map((c,i)=>c*(maxz-minz)+(i===0?minz:0))};
console.log(JSON.stringify(conv,null,2));
