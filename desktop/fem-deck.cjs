const fs = require('node:fs');
function parseMesh(text) {
  const nodes = new Map(), elements = [], triangles = [];
  let mode = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('*')) {
      mode = /^\*NODE\s*$/i.test(line) ? 'nodes' : /type=C3D10/i.test(line) ? 'tet' : /type=CPS6/i.test(line) ? 'tri' : '';
      continue;
    }
    const a = line.split(',').map(s=>Number(s.trim()));
    if (!a.length || !a.every(Number.isFinite)) continue;
    if (mode==='nodes' && a.length===4) nodes.set(a[0],a.slice(1));
    if (mode==='tet' && a.length===11) elements.push(a);
    if (mode==='tri' && a.length===7) triangles.push(a);
  }
  if (nodes.size<4 || !elements.length || nodes.size>200000 || elements.length>500000) throw Error('Unsupported or excessive volume mesh');
  for (const e of elements) if (!e.slice(1).every(id=>nodes.has(id))) throw Error('Mesh has missing node references');
  return {nodes,elements,triangles};
}
function prepareDeck(mesh, settings) {
  const {nodes,elements,triangles}=mesh, axis=settings.axis;
  let lo=Infinity,hi=-Infinity;
  for(const p of nodes.values()){lo=Math.min(lo,p[axis]);hi=Math.max(hi,p[axis]);}
  const tolerance=Math.max(1e-10,(hi-lo)*1e-7);
  const fixed=[...nodes].filter(([,p])=>Math.abs(p[axis]-(settings.supportMax?hi:lo))<tolerance).map(([id])=>id);
  const plane=settings.supportMax?lo:hi;
  if(fixed.length<3 || hi-lo<1e-8) throw Error('Support plane has insufficient extent');
  const weights=new Map();let area=0,supportArea=0;
  for(const tri of triangles){
    const ids=tri.slice(1),p=ids.map(id=>nodes.get(id));
    if(p.some(v=>!v)) throw Error('Missing surface node');
    const loaded=p.every(v=>Math.abs(v[axis]-plane)<tolerance);
    const supported=p.every(v=>Math.abs(v[axis]-(settings.supportMax?hi:lo))<tolerance);
    if(!loaded&&!supported)continue;
    const a=p[1].map((v,i)=>v-p[0][i]),b=p[2].map((v,i)=>v-p[0][i]);
    const faceArea=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;
    if(supported)supportArea+=faceArea;
    if(!loaded)continue;
    area+=faceArea;
    // Consistent integral of quadratic triangle shape functions for a uniform traction:
    // corner integral zero, midside integral area/3.
    for(const id of ids.slice(3))weights.set(id,(weights.get(id)??0)+faceArea/3);
  }
  if(!(supportArea>0))throw Error("Fixed support requires a planar surface with positive area");
  if(!(area>0) || !weights.size)throw Error('Load requires a planar outer surface opposite the support');
  const force=[0,0,0],moment=[0,0,0];
  const rows=[];
  for(const [id,weight] of weights){
    const f=settings.force.map(v=>v*weight/area),p=nodes.get(id);
    f.forEach((v,i)=>{force[i]+=v;if(v)rows.push(id+','+(i+1)+','+v);});
    moment[0]+=p[1]*f[2]-p[2]*f[1];moment[1]+=p[2]*f[0]-p[0]*f[2];moment[2]+=p[0]*f[1]-p[1]*f[0];
  }
  const deck=['*HEADING','Ultimate CAD linear static; SI m,N,Pa','*NODE',...[...nodes].map(([id,p])=>[id,...p].join(',')),
    '*ELEMENT,TYPE=C3D10,ELSET=BODY',...elements.map(e=>e.join(',')),
    '*NSET,NSET=ALLNODES',...([...nodes.keys()].map(String)),
    '*NSET,NSET=FIXED',...fixed.map(String),
    '*MATERIAL,NAME=ISOTROPIC','*ELASTIC',settings.young+','+settings.poisson,
    '*SOLID SECTION,ELSET=BODY,MATERIAL=ISOTROPIC','*BOUNDARY','FIXED,1,3','*STEP','*STATIC','*CLOAD',...rows,
    '*NODE FILE','U,RF','*EL FILE','S','*NODE PRINT,NSET=ALLNODES','U',
    '*NODE PRINT,NSET=FIXED,TOTALS=YES','RF','*END STEP'].join('\n')+'\n';
  return {deck,fixed,force,moment,loadedAreaM2:area};
}
module.exports={parseMesh,prepareDeck};
function parseResults(mesh, dat, frd, deck) {
  const disp=new Map(),reaction=new Map(),stress=new Map();
  let mode='';
  const row=/^\s*(\d+)\s+([-+0-9.Ee]+)\s+([-+0-9.Ee]+)\s+([-+0-9.Ee]+)\s*$/;
  for(const line of dat.split(/\r?\n/)){
    if(/displacements .*ALLNODES/.test(line))mode='disp';
    else if(/forces .*FIXED/.test(line))mode='reaction';
    else if(/total force/.test(line))mode='';
    const match=line.match(row);
    if(match && mode)(mode==='disp'?disp:reaction).set(Number(match[1]),match.slice(2).map(Number));
  }
  let reading=false;
  for(const line of frd.split(/\r?\n/)){
    if(line.startsWith(' -4'))reading=line.includes('STRESS');
    if(!reading || !line.startsWith(' -1'))continue;
    const id=Number(line.slice(3,13));
    const s=(line.slice(13).match(/[-+]?\d*\.\d+(?:[Ee][-+]?\d+)?/g)??[]).map(Number);
    if(s.length!==6)throw Error('Unsupported CalculiX nodal stress record');
    const [xx,yy,zz,xy,yz,zx]=s;
    stress.set(id,Math.sqrt(((xx-yy)**2+(yy-zz)**2+(zz-xx)**2)/2+3*(xy*xy+yz*yz+zx*zx)));
  }
  const reactionSum=[0,0,0],moment=[0,0,0];
  for(const id of deck.fixed){
    const force=reaction.get(id),p=mesh.nodes.get(id);
    if(!force)throw Error('Missing support reaction');
    force.forEach((v,i)=>reactionSum[i]+=v);
    moment[0]+=p[1]*force[2]-p[2]*force[1];moment[1]+=p[2]*force[0]-p[0]*force[2];moment[2]+=p[0]*force[1]-p[1]*force[0];
  }
  const residual=Math.hypot(...reactionSum.map((v,i)=>v+deck.force[i]));
  const momentResidual=Math.hypot(...moment.map((v,i)=>v+deck.moment[i]));
  if(residual>1e-4*Math.max(1,Math.hypot(...deck.force)))throw Error('Reaction force equilibrium failed');
  if(momentResidual>1e-4*Math.max(1,Math.hypot(...deck.moment)))throw Error('Reaction moment equilibrium failed');
  const ids=[...mesh.nodes.keys()],index=new Map(ids.map((id,i)=>[id,i]));
  const positions=[],displacements=[],vonMises=[];
  for(const id of ids){
    const u=disp.get(id),vm=stress.get(id);
    if(!u || vm===undefined || ![...u,vm].every(Number.isFinite))throw Error('Missing or nonfinite solution');
    positions.push(...mesh.nodes.get(id));displacements.push(...u);vonMises.push(vm);
  }
  const indices=[];
  // Three quadratic triangles per midside vertex plus the central triangle:
  // this visual subdivision displays the actual computed midside displacement.
  for(const tri of mesh.triangles){
    const [a,b,c,ab,bc,ca]=tri.slice(1).map(id=>index.get(id));
    if([a,b,c,ab,bc,ca].some(v=>v===undefined))throw Error('Bad display surface');
    indices.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
  }
  return {units:{length:'m',force:'N',stress:'Pa'},positions,displacements,vonMises,indices,
    nodes:ids.length,elements:mesh.elements.length,loadedAreaM2:deck.loadedAreaM2,
    appliedForceN:deck.force,reactionForceN:reactionSum,forceResidualN:residual,momentResidualNm:momentResidual,
    maxDisplacementM:ids.reduce((max,id)=>Math.max(max,Math.hypot(...disp.get(id))),0),maxVonMisesPa:vonMises.reduce((max,v)=>Math.max(max,v),0)};
}
module.exports.parseResults=parseResults;
