import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";

it.skipIf(!process.env.LAYERLING_COLOR_BENCH)("measures current full-selection color reconstruction versus sparse updates", () => {
  const results=[];
  for(const n of [50000,250000,1000000]) {
    const weights=new Float64Array(n);for(let i=0;i<1000;i++)weights[i+1000]=i/1000;
    let original=new Float32Array(n*3);const start=performance.now();
    for(let k=0;k<20;k++) {
      const colors=new Float32Array(n*3);
      for(let i=0;i<weights.length;i++){const w=weights[i];colors.set([.1+.9*w,.65-.25*w,.85-.75*w],i*3);}original=colors;
    }
    const baselineMs=performance.now()-start,optimized=new Float32Array(n*3);
    for(let i=0;i<n;i++)optimized.set([.1,.65,.85],i*3);
    const sparse=performance.now();
    for(let k=0;k<20;k++)for(let i=1000;i<2000;i++){const w=weights[i];optimized[i*3]=.1+.9*w;optimized[i*3+1]=.65-.25*w;optimized[i*3+2]=.85-.75*w;}
    const sparseMs=performance.now()-sparse;
    expect(Buffer.from(optimized.buffer).equals(Buffer.from(original.buffer))).toBe(true);
    results.push({vertices:n,strokes:20,changedPerStroke:1000,baselineMs,sparseMs,baselinePayloadBytes:n*8,sparsePayloadBytes:1000*12});
  }
  writeFileSync(process.env.LAYERLING_COLOR_BENCH!,JSON.stringify(results,null,2));
},60000);
