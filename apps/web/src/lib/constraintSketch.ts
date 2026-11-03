import { resolvePadDepth, type SketchPadHistory } from "@/lib/sketchPadHistory";
import type { ModuleStatic, SketchPrimitive } from "@salusoft89/planegcs";
import type { SketchProfile, SketchPoint, SketchSegment } from "@/types/layerling";

export type ConstraintPoint = { id: string; kind: "point"; x: number; y: number; fixed: boolean; name?: string };
export type ConstraintCurve = { id: string; kind: "line"; start: string; end: string; construction?: boolean; name?: string }
  | { id: string; kind: "circle"; center: string; radius: number; construction?: boolean; name?: string }
  | { id: string; kind: "arc"; center: string; start: string; end: string; radius: number; startAngle: number; endAngle: number; construction?: boolean; name?: string };
export type ConstraintEntity = ConstraintPoint | ConstraintCurve;
export const CONSTRAINT_KINDS = ["coincident", "concentric", "horizontal", "vertical", "parallel", "perpendicular", "tangent", "equal", "distance", "radius", "diameter", "x", "y", "angle", "pointOnCircle"] as const;
export type ConstraintKind = typeof CONSTRAINT_KINDS[number];
export type SketchConstraint = { id: string; kind: ConstraintKind; first: string; second?: string; value?: number; name?: string };
/** Sketch lengths and coordinates are mm; persisted angular dimensions are degrees. */
export type ConstraintSketch = { schema: 1; title: string; entities: ConstraintEntity[]; constraints: SketchConstraint[]; extrusionMm: number; featureHistory?: SketchPadHistory };
export type ConstraintSolution = { valid: boolean; document: ConstraintSketch; dof: number; status: number; conflicts: string[]; redundant: string[]; residuals: { id: string; value: number; unit: "mm" | "rad" }[]; message: string };
export type PlaneGcsRuntime = { api: Pick<typeof import("@salusoft89/planegcs"), "GcsWrapper">; module: ModuleStatic };
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radians: number) => radians * 180 / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function validateConstraintSketch(value: unknown): asserts value is ConstraintSketch {
  if (!value || typeof value !== "object") throw new Error("Sketch definition is missing");
  const d = value as ConstraintSketch;
  if (d.schema !== 1 || typeof d.title !== "string" || !d.title.trim() || d.title.length > 160 || !Array.isArray(d.entities) || !Array.isArray(d.constraints) || d.entities.length > 512 || d.constraints.length > 2048) throw new Error("Unsupported or excessive sketch definition");
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6;
  if (!finite(d.extrusionMm) || d.extrusionMm <= 0) throw new Error("Extrusion must be a positive finite length in mm");
  if (d.featureHistory !== undefined) {
    resolvePadDepth(d.featureHistory);
    if (d.featureHistory.pocket) validateConstraintSketch(d.featureHistory.pocket.profile);
  }
  const ids = new Set<string>();
  for (const o of [...d.entities, ...d.constraints]) {
    if (!o || typeof o.id !== "string" || !o.id || o.id.length > 160 || o.id.startsWith("$") || ids.has(o.id)) throw new Error("Sketch IDs must be unique and nonempty");
    ids.add(o.id);
  }
  const entities = new Map(d.entities.map(e => [e.id, e]));
  const point = (id: string) => { const p = entities.get(id); if (p?.kind !== "point") throw new Error(`Missing point reference: ${id}`); return p; };
  for (const e of d.entities) {
    if (e.name !== undefined && (typeof e.name !== "string" || e.name.length > 160)) throw new Error("Invalid entity name");
    if (e.kind === "point") {
      if (!finite(e.x) || !finite(e.y) || typeof e.fixed !== "boolean") throw new Error(`Invalid point: ${e.id}`);
    } else if (e.kind === "line") {
      const a = point(e.start), b = point(e.end);
      if (Math.hypot(a.x-b.x,a.y-b.y) < 1e-8) throw new Error(`Zero-length line: ${e.id}`);
    } else if (e.kind === "circle" || e.kind === "arc") {
      point(e.center);
      if (!finite(e.radius) || e.radius <= 1e-8) throw new Error(`Invalid radius: ${e.id}`);
      if (e.kind === "arc") {
        point(e.start); point(e.end);
        if (!finite(e.startAngle) || !finite(e.endAngle) || e.endAngle <= e.startAngle || e.endAngle-e.startAngle >= 360) throw new Error(`Arc requires a positive sweep below 360 degrees: ${e.id}`);
      }
    } else throw new Error("Unsupported sketch entity");
  }
  for (const c of d.constraints) {
    if (!(CONSTRAINT_KINDS as readonly string[]).includes(c.kind) || !entities.has(c.first) || (c.second !== undefined && !entities.has(c.second))) throw new Error(`Invalid constraint reference: ${c.id}`);
    if (["distance","radius","diameter","x","y","angle"].includes(c.kind) && !finite(c.value)) throw new Error(`Invalid dimension: ${c.id}`);
    if (["distance","radius","diameter"].includes(c.kind) && !(c.value! > 0)) throw new Error(`Dimension must be positive: ${c.id}`);
    if (["coincident","concentric","parallel","perpendicular","tangent","equal","distance","angle","pointOnCircle"].includes(c.kind) && !c.second) throw new Error(`Constraint ${c.id} requires a second entity`);
  }
}

function helpers(d: ConstraintSketch) {
  const entities = new Map(d.entities.map(e => [e.id,e]));
  const get = (id?: string): ConstraintEntity => { const e = id && entities.get(id); if (!e) throw new Error(`Missing entity: ${id}`); return e; };
  const point = (id: string) => { const p = get(id); if (p.kind !== "point") throw new Error(`Expected point: ${id}`); return p; };
  const line = (id?: string) => { const l = get(id); if (l.kind !== "line") throw new Error(`Expected line: ${id}`); return l; };
  const round = (id?: string) => { const e = get(id); if (e.kind !== "circle" && e.kind !== "arc") throw new Error(`Expected circle or arc: ${id}`); return e; };
  const center = (id?: string) => point(round(id).center);
  const vector = (id?: string) => { const l=line(id),a=point(l.start),b=point(l.end);return [b.x-a.x,b.y-a.y] as const; };
  return {get,point,line,round,center,vector};
}

function primitiveConstraint(d: ConstraintSketch, c: SketchConstraint): SketchPrimitive {
  const h=helpers(d), a=h.get(c.first), b=c.second ? h.get(c.second) : undefined;
  const base={id:c.id}; let p: Record<string, unknown>;
  switch(c.kind) {
    case "coincident": h.point(a.id);h.point(b!.id);p={type:"p2p_coincident",p1_id:a.id,p2_id:b!.id};break;
    case "concentric": p={type:"p2p_coincident",p1_id:h.round(a.id).center,p2_id:h.round(b?.id).center};break;
    case "horizontal": case "vertical": h.line(a.id);p={type:`${c.kind}_l`,l_id:a.id};break;
    case "parallel": case "perpendicular": case "angle": h.line(a.id);h.line(b?.id);p={type:c.kind==="angle"?"l2l_angle_ll":c.kind==="perpendicular"?"perpendicular_ll":"parallel",l1_id:a.id,l2_id:b!.id,...(c.kind==="angle"?{angle:radians(c.value!)}:{})};break;
    case "distance": h.point(a.id);h.point(b!.id);p={type:"p2p_distance",p1_id:a.id,p2_id:b!.id,distance:c.value};break;
    case "x": case "y": h.point(a.id);p={type:`coordinate_${c.kind}`,p_id:a.id,[c.kind]:c.value};break;
    case "radius": case "diameter": {const r=h.round(a.id);p={type:`${r.kind}_${c.kind}`,[r.kind==="circle"?"c_id":"a_id"]:r.id,[c.kind]:c.value};break;}
    case "pointOnCircle": h.point(a.id);if(h.round(b?.id).kind!=="circle")throw new Error("Point-on-circle requires a circle");p={type:"point_on_circle",p_id:a.id,c_id:b!.id};break;
    case "equal": if(a.kind==="line"&&b?.kind==="line")p={type:"equal_length",l1_id:a.id,l2_id:b.id};else {const x=h.round(a.id),y=h.round(b?.id);if(x.kind==="circle"&&y.kind==="arc")p={type:"equal_radius_ca",c_id:x.id,a_id:y.id};else if(x.kind==="arc"&&y.kind==="circle")p={type:"equal_radius_ca",c_id:y.id,a_id:x.id};else p={type:x.kind==="circle"?"equal_radius_cc":"equal_radius_aa",[x.kind==="circle"?"c1_id":"a1_id"]:x.id,[x.kind==="circle"?"c2_id":"a2_id"]:y.id};}break;
    case "tangent": {let x=a,y=b!;if(y.kind==="line"){[x,y]=[y,x];}if(x.kind==="line"){h.line(x.id);const r=h.round(y.id);p={type:r.kind==="circle"?"tangent_lc":"tangent_la",l_id:x.id,[r.kind==="circle"?"c_id":"a_id"]:r.id};}else {const r=h.round(x.id),s=h.round(y.id);if(r.kind!==s.kind)p={type:"tangent_ca",c_id:r.kind==="circle"?r.id:s.id,a_id:r.kind==="arc"?r.id:s.id};else p={type:r.kind==="circle"?"tangent_cc":"tangent_aa",[r.kind==="circle"?"c1_id":"a1_id"]:r.id,[r.kind==="circle"?"c2_id":"a2_id"]:s.id};}break;}
    default: throw new Error("Unsupported constraint");
  }
  return {...base,...p} as unknown as SketchPrimitive;
}

export function constraintResiduals(d: ConstraintSketch): ConstraintSolution["residuals"] {
  const h=helpers(d), distance=(a:ConstraintPoint,b:ConstraintPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
  const results=d.constraints.map(c=>{
    const a=h.get(c.first),b=c.second?h.get(c.second):undefined;let v=0,unit:"mm"|"rad"="mm";
    switch(c.kind){
      case "coincident":v=distance(h.point(a.id),h.point(b!.id));break;
      case "concentric":v=distance(h.center(a.id),h.center(b?.id));break;
      case "horizontal":v=Math.abs(h.vector(a.id)[1]);break;
      case "vertical":v=Math.abs(h.vector(a.id)[0]);break;
      case "parallel":case "perpendicular":case "angle":{const x=h.vector(a.id),y=h.vector(b?.id),angle=Math.atan2(x[0]*y[1]-x[1]*y[0],x[0]*y[0]+x[1]*y[1]);unit="rad";v=c.kind==="parallel"?Math.abs(Math.sin(angle)):c.kind==="perpendicular"?Math.abs(Math.cos(angle)):Math.abs(wrap(angle-radians(c.value!)));break;}
      case "distance":v=Math.abs(distance(h.point(a.id),h.point(b!.id))-c.value!);break;
      case "x":case "y":v=Math.abs(h.point(a.id)[c.kind]-c.value!);break;
      case "radius":case "diameter":v=Math.abs(h.round(a.id).radius*(c.kind==="diameter"?2:1)-c.value!);break;
      case "pointOnCircle":v=Math.abs(distance(h.point(a.id),h.center(b?.id))-h.round(b?.id).radius);break;
      case "equal":v=a.kind==="line"?Math.abs(Math.hypot(...h.vector(a.id))-Math.hypot(...h.vector(b?.id))):Math.abs(h.round(a.id).radius-h.round(b?.id).radius);break;
      case "tangent":{let x=a,y=b!;if(y.kind==="line")[x,y]=[y,x];if(x.kind==="line"){const l=h.line(x.id),p=h.point(l.start),r=h.round(y.id),center=h.center(y.id),[dx,dy]=h.vector(x.id);v=Math.abs(Math.abs(dx*(center.y-p.y)-dy*(center.x-p.x))/Math.hypot(dx,dy)-r.radius);}else {const r=h.round(x.id),s=h.round(y.id),gap=distance(h.center(x.id),h.center(y.id));v=Math.min(Math.abs(gap-r.radius-s.radius),Math.abs(gap-Math.abs(r.radius-s.radius)));}break;}
    }
    return {id:c.id,value:v,unit};
  });
  for(const e of d.entities)if(e.kind==="arc"){const p=h.center(e.id),s=h.point(e.start),t=h.point(e.end);results.push({id:`$arc:${e.id}`,unit:"mm",value:Math.max(Math.hypot(s.x-p.x-e.radius*Math.cos(radians(e.startAngle)),s.y-p.y-e.radius*Math.sin(radians(e.startAngle))),Math.hypot(t.x-p.x-e.radius*Math.cos(radians(e.endAngle)),t.y-p.y-e.radius*Math.sin(radians(e.endAngle))))});}
  return results;
}

export function solveConstraintSketch(input: ConstraintSketch, runtime: PlaneGcsRuntime): ConstraintSolution {
  validateConstraintSketch(input);const document=structuredClone(input);
  if (document.featureHistory) document.extrusionMm = resolvePadDepth(document.featureHistory);
  const pocket = document.featureHistory?.pocket;
  if (pocket && !pocket.suppressed) {
    const solved = solveConstraintSketch(pocket.profile,runtime);
    if (!solved.valid) throw Error("Pocket sketch " + pocket.sketchId + ": " + solved.message);
    pocket.profile = solved.document;
  }
  const wrapper=new runtime.api.GcsWrapper(new runtime.module.GcsSystem(),runtime.module);
  try {
    const objects:SketchPrimitive[]=document.entities.filter(e=>e.kind==="point").map(e=>{const p=e as ConstraintPoint;return {id:p.id,type:"point",x:p.x,y:p.y,fixed:p.fixed};});
    for(const e of document.entities){if(e.kind==="line")objects.push({id:e.id,type:"line",p1_id:e.start,p2_id:e.end});if(e.kind==="circle")objects.push({id:e.id,type:"circle",c_id:e.center,radius:e.radius});if(e.kind==="arc")objects.push({id:e.id,type:"arc",c_id:e.center,start_id:e.start,end_id:e.end,radius:e.radius,start_angle:radians(e.startAngle),end_angle:radians(e.endAngle)});}
    for(const e of document.entities)if(e.kind==="arc")objects.push({id:`$arc:${e.id}`,type:"arc_rules",a_id:e.id});
    objects.push(...document.constraints.map(c=>{try{return primitiveConstraint(document,c);}catch(error){throw new Error(`${c.id}: ${error instanceof Error?error.message:String(error)}`);}}));
    wrapper.push_primitives_and_params(objects);wrapper.set_convergence_threshold(1e-10);wrapper.set_max_iterations(100);
    const status=wrapper.solve(),conflicts=wrapper.get_gcs_conflicting_constraints(),redundant=[...new Set([...wrapper.get_gcs_redundant_constraints(),...wrapper.get_gcs_partially_redundant_constraints()])],dof=wrapper.gcs.dof();
    if(status===0||status===1)wrapper.apply_solution();
    const solved=new Map(wrapper.sketch_index.get_primitives().map(e=>[e.id,e]));
    document.entities=document.entities.map(e=>{const p=solved.get(e.id);if(e.kind==="point"&&p?.type==="point")return {...e,x:p.x,y:p.y};if((e.kind==="circle"||e.kind==="arc")&&(p?.type==="circle"||p?.type==="arc")){if(e.kind==="arc"&&p.type==="arc")return {...e,radius:p.radius,startAngle:degrees(p.start_angle),endAngle:degrees(p.end_angle)};return {...e,radius:p.radius};}return e;});
    const residuals=constraintResiduals(document),valid=(status===0||status===1)&&!conflicts.length&&residuals.every(r=>Number.isFinite(r.value)&&r.value<=(r.unit==="mm"?1e-7:1e-8));
    if(valid)validateConstraintSketch(document);
    return {valid,document:valid?document:structuredClone(input),dof,status,conflicts,redundant,residuals,message:valid?"":conflicts.length?"Conflicting constraints":"Constraint solve did not satisfy the requested tolerances"};
  } finally {wrapper.destroy_gcs_module();}
}

/** Analytic curve definitions survive the sampled drawing/profile boundary. */
export function constraintSketchProfile(document: ConstraintSketch): SketchProfile {
  validateConstraintSketch(document);const h=helpers(document),points=new Map<string,SketchPoint>(),segments:SketchSegment[]=[];
  for(const e of document.entities)if(e.kind==="point")points.set(e.id,{id:e.id,x:e.x,z:e.y});
  for(const e of document.entities){
    if(e.kind==="line"){segments.push({id:e.id,startId:e.start,endId:e.end,kind:"line",construction:e.construction});continue;}
    if(e.kind!=="circle"&&e.kind!=="arc")continue;
    const c=h.center(e.id),start=e.kind==="circle"?0:radians(e.startAngle),sweep=e.kind==="circle"?2*Math.PI:radians(e.endAngle-e.startAngle),count=Math.ceil(sweep/(Math.PI/2));
    for(let i=0;i<count;++i){const a=start+sweep*i/count,b=start+sweep*(i+1)/count,first=e.kind==="arc"&&i===0?e.start:`${e.id}.p${i}`,last=e.kind==="arc"&&i===count-1?e.end:`${e.id}.p${(i+1)%count}`,k=4/3*Math.tan((b-a)/4);
      const p={x:c.x+e.radius*Math.cos(a),z:c.y+e.radius*Math.sin(a)},q={x:c.x+e.radius*Math.cos(b),z:c.y+e.radius*Math.sin(b)};
      points.set(first,{...points.get(first),id:first,...p,handleOut:{x:p.x-e.radius*k*Math.sin(a),z:p.z+e.radius*k*Math.cos(a)}});
      points.set(last,{...points.get(last),id:last,...q,handleIn:{x:q.x+e.radius*k*Math.sin(b),z:q.z-e.radius*k*Math.cos(b)}});
      segments.push({id:`${e.id}.s${i}`,startId:first,endId:last,kind:"bezier",construction:e.construction,analyticMidpoint:{x:c.x+e.radius*Math.cos((a+b)/2),z:c.y+e.radius*Math.sin((a+b)/2)}});
    }
  }
  // Coincident endpoints share topology by their declared constraint, never by
  // a nearest-point heuristic. Geometry is accepted only after residual checks.
  const roots=new Map<string,string>();
  const root=(id:string):string=>{const p=roots.get(id);if(!p)return id;const r=root(p);roots.set(id,r);return r;};
  for(const c of document.constraints)if(c.kind==="coincident"){const a=root(c.first),b=root(c.second!);if(a!==b)roots.set(b,a);}
  for(const segment of segments){segment.startId=root(segment.startId);segment.endId=root(segment.endId);}
  for(const point of points.values()){const id=root(point.id);if(id!==point.id){const canonical=points.get(id);if(canonical)points.set(id,{...canonical,...(point.handleIn?{handleIn:point.handleIn}:{}),...(point.handleOut?{handleOut:point.handleOut}:{})});}}
  return {points:[...points.values()],segments,constraintSketch:structuredClone(document)};
}

export function constraintSketchLinePositions(document: ConstraintSketch): number[] {
  const h=helpers(document), positions:number[]=[];
  for(const e of document.entities){
    if(e.kind==="line"){const a=h.point(e.start),b=h.point(e.end);positions.push(a.x,0,a.y,b.x,0,b.y);}
    if(e.kind==="circle"||e.kind==="arc"){const c=h.center(e.id),a=e.kind==="circle"?0:radians(e.startAngle),span=e.kind==="circle"?2*Math.PI:radians(e.endAngle-e.startAngle),n=Math.max(2,Math.ceil(span/(Math.PI*2)*96));for(let i=0;i<n;++i)for(const t of [a+span*i/n,a+span*(i+1)/n])positions.push(c.x+e.radius*Math.cos(t),0,c.y+e.radius*Math.sin(t));}
  }
  return positions;
}

export function mountingPlateSketch(): ConstraintSketch {
  const entities:ConstraintEntity[]=[{id:"origin",kind:"point",x:0,y:0,fixed:true},{id:"axis-end",kind:"point",x:40,y:0,fixed:true},{id:"axis",kind:"line",start:"origin",end:"axis-end",construction:true},{id:"outer",kind:"circle",center:"origin",radius:40,name:"Outer rim"},{id:"pitch",kind:"circle",center:"origin",radius:28,construction:true,name:"Bolt circle"}];
  const constraints:SketchConstraint[]=[{id:"outer-radius",kind:"radius",first:"outer",value:40,name:"Plate radius"},{id:"pitch-radius",kind:"radius",first:"pitch",value:28,name:"Bolt circle radius"}];
  for(let i=0;i<6;++i){const angle=i*60;entities.push({id:`center-${i}`,kind:"point",x:28*Math.cos(radians(angle)),y:28*Math.sin(radians(angle)),fixed:false,name:`Hole center ${i+1}`},{id:`radial-${i}`,kind:"line",start:"origin",end:`center-${i}`,construction:true},{id:`hole-${i}`,kind:"circle",center:`center-${i}`,radius:2.5,name:`Hole ${i+1}`});constraints.push({id:`pitch-on-${i}`,kind:"pointOnCircle",first:`center-${i}`,second:"pitch"},{id:`angle-${i}`,kind:"angle",first:"axis",second:`radial-${i}`,value:angle},i===0?{id:"hole-radius",kind:"radius",first:"hole-0",value:2.5,name:"Hole radius"}:{id:`equal-hole-${i}`,kind:"equal",first:"hole-0",second:`hole-${i}`});}
  return {schema:1,title:"Six-hole mounting plate",entities,constraints,extrusionMm:5};
}
