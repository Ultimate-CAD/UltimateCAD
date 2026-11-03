import {OcctKernel} from "occt-wasm";
import path from "node:path";
import {fileURLToPath} from "node:url";
const k = await OcctKernel.init({wasm:path.join(path.dirname(fileURLToPath(import.meta.resolve("occt-wasm"))),"occt-wasm.wasm")});
const plate=k.makeBox(60,40,5);
function bore(body,x){return k.cut(body,k.translate(k.makeCylinder(2,7),x,20,-1));}
function rims(shape){return k.getSubShapes(shape,"edge").flatMap((edge,id)=>k.curveType(edge)==="circle"?[{id,bounds:k.getBoundingBox(edge),length:k.getLength(edge)}]:[]);}
const both=bore(bore(plate,15),45),onlySecond=bore(plate,45);
console.log(JSON.stringify({both:rims(both),suppressFirst:rims(onlySecond)},null,2));
k.releaseAll();
