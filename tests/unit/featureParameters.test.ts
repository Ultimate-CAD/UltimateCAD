import {expect,it} from "vitest";
import {evaluateFeatureParameters as run, type FeatureParameter} from "@/lib/featureParameters";
const length=(name:string,expression:string):FeatureParameter=>({name,expression,unit:"mm"});
it("evaluates a diamond once and replaces dependencies across transactions",()=>{
  const defs=[length("a","1 cm"),length("b","2*a"),length("c","a/2"),length("d","b+c"),length("stable","1 in")];
  const first=run(defs);
  expect(first.cache.get("d")?.value).toBe(25);
  defs[0]=length("a","2 cm");
  const next=run(defs,first.cache);
  expect(next.evaluated).toEqual(["a","b","c","d"]);
  defs[3]=length("d","stable");
  const replaced=run(defs,next.cache);
  const removed=run(defs.slice(3),replaced.cache);
  expect(removed.evaluated).toEqual([]);
  expect(removed.cache.get("d")?.value).toBe(25.4);
});
it("rejects a failed transaction without changing the last good values",()=>{
  const good=run([length("a","3 mm"),length("b","2*a")]);
  expect(()=>run([length("a","b"),length("b","a")],good.cache)).toThrow(/cycle/);
  expect(()=>run([length("b","2*a")],good.cache)).toThrow(/Missing parameter a/);
  expect(()=>run([length("a","1 mm / 0")],good.cache)).toThrow(/a: Invalid division/);
  expect(good.cache.get("b")?.value).toBe(6);
});
it("preserves units, operator precedence and angular conventions",()=>{
  expect(run([length("a","1 mm + 2 cm * sin(90 deg)")]).cache.get("a")?.value).toBe(21);
  for(const expr of ["1 mm + 2 deg","tan(90 deg)*1 mm","sqrt(-2)*1 mm","1e300*1e300*1 mm","a.constructor()"])expect(()=>run([length("a",expr)])).toThrow();
});
