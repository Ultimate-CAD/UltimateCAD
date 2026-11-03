/** Persist expressions, names and declared units. Cache only successful evaluation transactions. */
export type ParameterUnit = "mm" | "deg" | "scalar";
export interface FeatureParameter { name: string; unit: ParameterUnit; expression: string }
type Quantity = { value: number; unit: ParameterUnit };
type Expr = { literal: number; unit: ParameterUnit } | { ref: string } |
  { operator: string; left: Expr; right: Expr } | { call: string; arg: Expr };
const scales = new Map<string, [ParameterUnit, number]>([
  ["mm", ["mm", 1]], ["cm", ["mm", 10]], ["in", ["mm", 25.4]],
  ["deg", ["deg", 1]], ["rad", ["deg", 180 / Math.PI]],
]);
const identifier = /^[A-Za-z_][A-Za-z_0-9]*$/;
const functions = new Set(["abs","sqrt","sin","cos","tan"]);
const precedence = new Map([["+",1],["-",1],["*",2],["/",2]]);

function parse(text: string): Expr {
  if (typeof text !== "string" || text.length > 512) throw Error("Expression exceeds 512 characters");
  const tokens = text.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g) ?? [];
  let pos = 0;
  function expression(minimum: number): Expr {
    const token = tokens[pos++];
    let left: Expr;
    if (token === "(") {
      left = expression(0);
      if (tokens[pos++] !== ")") throw Error("Expected closing parenthesis");
    } else if (token === "-" || token === "+") {
      left = {operator:"*", left:{literal:token === "-" ? -1 : 1,unit:"scalar"}, right:expression(3)};
    } else if (token !== undefined && /^[.0-9]/.test(token) && Number.isFinite(Number(token))) {
      const suffix = scales.get(tokens[pos]);
      if (suffix) pos++;
      left = {literal:Number(token)*(suffix?.[1] ?? 1), unit:suffix?.[0] ?? "scalar"};
    } else if (token && identifier.test(token)) {
      if (tokens[pos] === "(") {
        if (!functions.has(token)) throw Error("Unknown function " + token);
        pos++;
        left = {call:token,arg:expression(0)};
        if (tokens[pos++] !== ")") throw Error("Expected closing parenthesis");
      } else left = {ref:token};
    } else throw Error("Expected a number or a parameter name");
    while ((precedence.get(tokens[pos]) ?? -1) >= minimum) {
      const operator = tokens[pos++];
      left = {operator,left,right:expression(precedence.get(operator)! + 1)};
    }
    return left;
  }
  const result = expression(0);
  if (pos !== tokens.length) throw Error("Unexpected token " + tokens[pos]);
  return result;
}

function calculate(node: Expr, lookup: (name:string)=>Quantity): Quantity {
  if ("literal" in node) return {value:node.literal,unit:node.unit};
  if ("ref" in node) return lookup(node.ref);
  if ("call" in node) {
    const q = calculate(node.arg,lookup);
    if (node.call === "abs") return {...q,value:Math.abs(q.value)};
    if (node.call === "sqrt") {
      if (q.unit !== "scalar" || q.value < 0) throw Error("sqrt needs a nonnegative scalar");
      return {unit:"scalar",value:Math.sqrt(q.value)};
    }
    if (q.unit !== "deg") throw Error(node.call + " requires an angle");
    const rad = q.value * Math.PI / 180;
    if (node.call === "tan" && Math.abs(Math.cos(rad)) < 1e-14) throw Error("Undefined tangent");
    return {unit:"scalar",value:node.call==="sin"?Math.sin(rad):node.call==="cos"?Math.cos(rad):Math.tan(rad)};
  }
  const a = calculate(node.left,lookup), b = calculate(node.right,lookup);
  if (node.operator === "+" || node.operator === "-") {
    if (a.unit !== b.unit) throw Error("Addition and subtraction require matching units");
    return {unit:a.unit,value:node.operator === "+" ? a.value+b.value : a.value-b.value};
  }
  if (node.operator === "*") {
    if (a.unit !== "scalar" && b.unit !== "scalar") throw Error("Multiplication requires a scalar");
    return {unit:a.unit === "scalar" ? b.unit : a.unit,value:a.value*b.value};
  }
  if (b.value === 0 || (b.unit !== "scalar" && b.unit !== a.unit)) throw Error("Invalid division");
  return {unit:b.unit === "scalar" ? a.unit : "scalar",value:a.value/b.value};
}

interface Entry extends Quantity { source:string; deps:Map<string,Entry> }
export type ParameterCache = ReadonlyMap<string,Entry>;

export function evaluateFeatureParameters(parameters:FeatureParameter[], previous?:ParameterCache) {
  if (!Array.isArray(parameters) || parameters.length > 256) throw Error("Maximum 256 parameters");
  const defs = new Map<string,FeatureParameter>(), result = new Map<string,Entry>();
  for (const p of parameters) {
    if (!p || typeof p.name !== "string" || !identifier.test(p.name) || defs.has(p.name) || scales.has(p.name) || functions.has(p.name)) throw Error("Invalid or duplicate parameter name");
    if (!["mm","deg","scalar"].includes(p.unit)) throw Error(p.name + ": invalid unit");
    defs.set(p.name,p);
  }
  const active = new Set<string>(), evaluated:string[] = [];
  function visit(name:string):Entry {
    const completed = result.get(name);
    if (completed) return completed;
    const p = defs.get(name);
    if (!p) throw Error("Missing parameter " + name);
    if (active.has(name)) throw Error("Parameter cycle: " + [...active,name].join(" -> "));
    active.add(name);
    try {
      const old = previous?.get(name);
      if (old && old.source === p.expression && old.unit === p.unit &&
          [...old.deps].every(([key,value])=>visit(key)===value)) {
        result.set(name,old);
        return old;
      }
      const deps = new Map<string,Entry>();
      const q = calculate(parse(p.expression), key => {
        const value = visit(key); deps.set(key,value); return value;
      });
      if (!Number.isFinite(q.value) || q.unit !== p.unit) throw Error("Expected finite " + p.unit);
      const entry = {...q,source:p.expression,deps};
      result.set(name,entry); evaluated.push(name);
      return entry;
    } catch (error) { throw Error(name + ": " + (error instanceof Error ? error.message : String(error))); }
    finally { active.delete(name); }
  }
  for (const key of [...defs.keys()].sort()) visit(key);
  return {cache:result as ParameterCache,evaluated};
}
