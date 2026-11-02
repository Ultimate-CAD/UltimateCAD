import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { unzipSync, strFromU8 } from "fflate";

export function strictTopology(vertices, faces) {
  const edges = new Map(),
    fans = new Map(),
    seen = new Set(),
    adj = new Map();
  let volume = 0;
  const key = (p) => p.map((v) => (Object.is(v, -0) ? 0 : v)).join(",");
  for (let i = 0; i < faces.length; i++) {
    const p = faces[i].map((j) => vertices[j]),
      keys = p.map(key),
      a = p[0],
      b = p[1],
      c = p[2];
    assert.ok(p.flat().every(Number.isFinite));
    const u = b.map((x, j) => x - a[j]),
      v = c.map((x, j) => x - a[j]);
    assert.ok(
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ) > 0,
      "Zero-area facet",
    );
    const face = keys.slice().sort().join("|");
    assert.ok(!seen.has(face), "Duplicate facet");
    seen.add(face);
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    keys.forEach((k) => {
      if (!fans.has(k)) fans.set(k, []);
      fans.get(k).push(i);
    });
    for (const [j, k] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const ids = [keys[j], keys[k]],
        edge = ids.slice().sort().join("|"),
        e = edges.get(edge) || [];
      e.push({ face: i, direction: ids[0] < ids[1] ? 1 : -1, ids });
      edges.set(edge, e);
    }
  }
  for (const e of edges.values()) {
    assert.equal(e.length, 2, "Edge is not closed/manifold");
    assert.equal(e[0].direction + e[1].direction, 0, "Winding mismatch");
    for (const k of e[0].ids) {
      if (!adj.has(k)) adj.set(k, new Map());
      const a = adj.get(k);
      for (const [x, y] of [
        [e[0].face, e[1].face],
        [e[1].face, e[0].face],
      ]) {
        if (!a.has(x)) a.set(x, []);
        a.get(x).push(y);
      }
    }
  }
  for (const [k, faces] of fans) {
    const seen = new Set(),
      pending = [faces[0]],
      graph = adj.get(k);
    while (pending.length) {
      const i = pending.pop();
      if (seen.has(i)) continue;
      seen.add(i);
      pending.push(...graph.get(i));
    }
    assert.equal(seen.size, faces.length, "Non-manifold vertex");
  }
  assert.ok(volume > 0);
  return {
    triangles: faces.length,
    vertices: new Set(vertices.map(key)).size,
    volumeMm3: volume,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    nonManifoldVertices: 0,
  };
}

export function verifyStl(file) {
  const bytes = readFileSync(file),
    g = new STLLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
    p = g.attributes.position.array;
  const vertices = Array.from({ length: p.length / 3 }, (_, i) =>
      Array.from(p.slice(i * 3, i * 3 + 3)),
    ),
    faces = Array.from({ length: p.length / 9 }, (_, i) => [
      i * 3,
      i * 3 + 1,
      i * 3 + 2,
    ]);
  const result = strictTopology(vertices, faces);
  g.dispose();
  return result;
}

export function verify3mf(file) {
  const xml = strFromU8(unzipSync(readFileSync(file))["3D/3dmodel.model"]);
  assert.match(xml, /unit="millimeter"/);
  const vertices = [
      ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g),
    ].map((m) => [+m[1], +m[2], +m[3]]),
    faces = [
      ...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
    ].map((m) => [+m[1], +m[2], +m[3]]);
  return strictTopology(vertices, faces);
}
