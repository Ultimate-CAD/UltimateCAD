import { beforeAll, describe, expect, it } from "vitest";
import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Shape, Path } from "three";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OcctKernel } from "occt-wasm";
import { planarMeshSolid } from "@/lib/cadMeshSolid";
import { shellSolid } from "@/lib/cadShell";
import { assertCadMeshBudget } from "@/lib/cadMeshBudget";

describe("dense display meshes with low geometric complexity", () => {
  let cad: OcctKernel;
  beforeAll(async () => { cad = await OcctKernel.init({ wasm: join(dirname(fileURLToPath(import.meta.resolve("occt-wasm"))), "occt-wasm.wasm") }); });
  for (const divisions of [18, 35, 41, 65, 92]) {
    it(`reconstructs, treats and hollows a ${12 * divisions ** 2}-triangle box without facet-dependent CAD edges`, () => {
      const geometry = new BoxGeometry(40, 30, 20, divisions, divisions, divisions);
      const positions = Array.from(geometry.attributes.position.array);
      const indices = Array.from(geometry.index!.array);
      if (divisions === 35) {
        // Add 36 internal centroids, preserving all original boundary edges:
        // the immediate acceptance case has exactly 14,772 triangles.
        const extra: number[] = [];
        for (let i = 0; i < 108; i += 3) {
          const [a,b,c] = indices.slice(i,i+3), center = positions.length / 3;
          positions.push(...[0,1,2].map(axis => (positions[a*3+axis]+positions[b*3+axis]+positions[c*3+axis])/3));
          indices.splice(i,3,a,b,center); extra.push(b,c,center,c,a,center);
        }
        indices.push(...extra); expect(indices.length / 3).toBe(14772);
      }
      assertCadMeshBudget(indices.length / 3);
      const started = performance.now();
      const solid = planarMeshSolid(cad, positions, indices)!;
      expect(solid).not.toBeNull(); expect(cad.isValid(solid)).toBe(true);
      expect(cad.subShapeCount(solid, "face")).toBe(6);
      expect(cad.getVolume(solid)).toBeCloseTo(24000, 3);
      const edges = cad.getSubShapes(solid,"edge"); expect(edges).toHaveLength(12);
      const fillet = cad.fillet(solid, edges, 1);
      expect(cad.isValid(fillet)).toBe(true); expect(cad.getVolume(fillet)).toBeLessThan(24000);
      const chamfer = cad.chamfer(solid, edges, 0.5);
      expect(cad.isValid(chamfer)).toBe(true); expect(cad.getVolume(chamfer)).toBeLessThan(24000);
      const hollow = shellSolid(cad, solid, 2, "none", "sharp");
      expect(cad.isValid(hollow)).toBe(true);
      expect(cad.getVolume(hollow)).toBeCloseTo(24000 - 36*26*16, 3);
      console.log(JSON.stringify({ triangles:indices.length/3, kernelFaces:6, kernelEdges:12, totalMs:performance.now()-started, rssMiB:process.memoryUsage().rss/1024/1024, peakRssMiB:process.resourceUsage().maxRSS/1024 }));
      cad.releaseAll(); geometry.dispose();
    });
  }
  it("retains faceted curvature and treats the rims of a 20736-triangle cylinder", () => {
    const geometry = new CylinderGeometry(20,20,30,128,80);
    const solid = planarMeshSolid(cad,geometry.attributes.position.array,geometry.index!.array)!;
    expect(geometry.index!.count / 3).toBe(20736);
    expect(solid).not.toBeNull(); expect(cad.isValid(solid)).toBe(true);
    const edges = cad.getSubShapes(solid,"edge");
    const rim = edges.filter(edge=>{const b=cad.getBoundingBox(edge,false);return Math.abs(b.ymax-15)<1e-4 && Math.abs(b.ymin-15)<1e-4;});
    expect(rim).toHaveLength(128);
    // getVolume uses OCCT's non-adaptive integral; for many small fillet
    // surfaces it overestimates here. Verify the manufacturing geometry with
    // independent signed tetrahedra instead of trusting that coarse query.
    const meshVolume = (body: number) => {
      const mesh=cad.tessellate(body,{linearDeflection:0.005,angularDeflection:0.1});
      let volume=0;
      for(let i=0;i<mesh.indices.length;i+=3){const a=mesh.indices[i]*3,b=mesh.indices[i+1]*3,c=mesh.indices[i+2]*3;const p=mesh.positions;volume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
      return Math.abs(volume);
    };
    const fillet = cad.fillet(solid,rim,0.5);
    expect(cad.isSolid(fillet)).toBe(true);expect(cad.isValid(fillet)).toBe(true);
    expect(meshVolume(fillet)).toBeLessThan(cad.getVolume(solid));
    const bounds=cad.getBoundingBox(fillet,false);
    expect(bounds.ymax).toBeCloseTo(15,4);expect(bounds.xmax).toBeCloseTo(20,4);
    const chamfer = cad.chamfer(solid,rim,0.5);
    expect(cad.isSolid(chamfer)).toBe(true);expect(cad.isValid(chamfer)).toBe(true);
    expect(meshVolume(chamfer)).toBeLessThan(cad.getVolume(solid));
    cad.releaseAll(); geometry.dispose();
  });
  it("preserves an open passage and concave outline during planar reconstruction", () => {
    const shape = new Shape(); shape.moveTo(0,0);shape.lineTo(30,0);shape.lineTo(30,10);shape.lineTo(20,10);shape.lineTo(20,30);shape.lineTo(0,30);shape.closePath();
    const hole = new Path();hole.moveTo(5,5);hole.lineTo(5,15);hole.lineTo(15,15);hole.lineTo(15,5);hole.closePath();shape.holes.push(hole);
    const geometry = new ExtrudeGeometry(shape,{depth:10,steps:50,bevelEnabled:false});
    const positions = geometry.attributes.position.array;
    const indices = Array.from({length:positions.length/3},(_,i)=>i);
    const solid = planarMeshSolid(cad,positions,indices)!;
    expect(solid).not.toBeNull();expect(cad.isValid(solid)).toBe(true);
    expect(cad.getVolume(solid)).toBeCloseTo((700-100)*10,3);
    cad.releaseAll();geometry.dispose();
  });
});
