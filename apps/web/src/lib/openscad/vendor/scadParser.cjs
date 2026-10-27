'use strict';

/**
 * Parser for the OpenSCAD Customizer annotation format.
 *
 * Implements the rules OpenSCAD itself uses (and which MakerWorld's Parametric
 * Model Maker follows):
 *
 *   - Only top-level variable assignments that appear BEFORE the first module or
 *     function definition are customizable.
 *   - `/* [Group Name] *​/` block comments open a group; `[Hidden]` suppresses
 *     everything after it until the next group.
 *   - `//` comments on their own line(s) directly above an assignment become the
 *     parameter description.
 *   - A trailing `// [...]` comment on the assignment line selects the widget.
 *   - Variables whose value is an expression (not a literal) are not
 *     customizable, because there is nothing sensible to put in the form.
 *
 * Also reports `module mw_plate_N()` definitions, the MakerWorld convention for
 * emitting a multi-plate 3MF.
 */

const RANGE_KEYWORDS = new Set(['color', 'image_surface', 'image_array']);

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Walk the source once, emitting document-ordered items at nesting depth 0.
 * Comments and strings are handled explicitly so that `;`, braces and brackets
 * appearing inside them never confuse the statement splitter.
 */
function scan(src) {
  const items = [];
  let i = 0;
  let line = 1;
  let depth = 0;
  let stmtStart = -1;
  let stmtChars = [];
  // Tracks whether anything other than whitespace has been seen on this line,
  // which is what separates a trailing comment from a leading one.
  let lineHasContent = false;

  const flushStatement = () => {
    const code = stmtChars.join('').trim();
    if (code) items.push({ kind: 'statement', code, line, start: stmtStart, end: i });
    stmtChars = [];
    stmtStart = -1;
  };

  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];

    // --- line comment ---
    if (c === '/' && c2 === '/') {
      const start = i;
      i += 2;
      let text = '';
      while (i < src.length && src[i] !== '\n') text += src[i++];
      items.push({
        kind: 'lineComment',
        text: text.trim(),
        line,
        start,
        ownLine: !lineHasContent,
      });
      continue;
    }

    // --- block comment ---
    if (c === '/' && c2 === '*') {
      const start = i;
      const startLine = line;
      i += 2;
      let text = '';
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        text += src[i++];
      }
      i += 2; // consume the closing */
      items.push({
        kind: 'blockComment',
        text: text.trim(),
        line: startLine,
        start,
        ownLine: !lineHasContent,
      });
      continue;
    }

    // --- string literal (stays part of the statement text) ---
    if (c === '"') {
      if (stmtStart < 0) stmtStart = i;
      stmtChars.push(c);
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          stmtChars.push(src[i], src[i + 1]);
          i += 2;
          continue;
        }
        stmtChars.push(src[i]);
        if (src[i] === '"') {
          i++;
          break;
        }
        if (src[i] === '\n') line++;
        i++;
      }
      lineHasContent = true;
      continue;
    }

    if (c === '\n') {
      line++;
      lineHasContent = false;
      if (stmtStart >= 0) stmtChars.push(c);
      i++;
      continue;
    }

    if (!/\s/.test(c)) lineHasContent = true;

    // --- module / function definitions at top level: these end parameter scope ---
    if (depth === 0 && /[A-Za-z_]/.test(c) && !isIdentChar(src[i - 1])) {
      const word = readWord(src, i);

      // `include <file>` and `use <file>` carry no terminating semicolon, so
      // without handling them here the statement splitter would run them into
      // whatever follows and swallow the first parameter of the file.
      if (word === 'include' || word === 'use') {
        const after = skipSpace(src, i + word.length);
        if (src[after] === '<') {
          const close = src.indexOf('>', after);
          if (close > 0) {
            for (let k = i; k <= close; k++) if (src[k] === '\n') line++;
            items.push({
              kind: word,
              file: src.slice(after + 1, close).trim(),
              line,
              start: i,
            });
            i = close + 1;
            stmtChars = [];
            stmtStart = -1;
            continue;
          }
        }
      }

      if (word === 'module' || word === 'function') {
        const startLine = line;
        const after = skipSpace(src, i + word.length);
        const name = readWord(src, after);
        if (word === 'module') {
          const res = skipModuleBody(src, after + name.length, line);
          line = res.line;
          items.push({ kind: 'module', name, line: startLine, start: i });
          i = res.index;
        } else {
          const res = skipToSemicolon(src, after + name.length, line);
          line = res.line;
          items.push({ kind: 'function', name, line: startLine, start: i });
          i = res.index;
        }
        // Anything half-collected before a definition was not an assignment.
        stmtChars = [];
        stmtStart = -1;
        continue;
      }
    }

    if (stmtStart < 0 && !/\s/.test(c)) stmtStart = i;

    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth = Math.max(0, depth - 1);

    if (c === ';' && depth === 0) {
      i++;
      flushStatement();
      continue;
    }

    stmtChars.push(c);
    i++;
  }
  flushStatement();
  return items;
}

function isIdentChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

function readWord(src, i) {
  let w = '';
  while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) w += src[i++];
  return w;
}

function skipSpace(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/** Skip from after a module's name to just past its closing brace. */
function skipModuleBody(src, i, line) {
  // Skip the parameter list first, so that a `{` default value inside it (or a
  // `;` in a string) does not terminate the scan early.
  let depth = 0;
  let seenBrace = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') line++;
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i++;
        if (src[i] === '\n') line++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '{') {
      depth++;
      seenBrace = true;
    } else if (c === '}') {
      depth--;
      if (seenBrace && depth === 0) return { index: i + 1, line };
    } else if (c === ';' && !seenBrace && depth === 0) {
      // A module declared with a single non-braced statement body.
      return { index: i + 1, line };
    }
    i++;
  }
  return { index: i, line };
}

function skipToSemicolon(src, i, line) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') line++;
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth <= 0) return { index: i + 1, line };
    i++;
  }
  return { index: i, line };
}

// ---------------------------------------------------------------------------
// Literal values
// ---------------------------------------------------------------------------

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Parse the right-hand side of an assignment.
 * Returns null when the value is an expression rather than a literal, which is
 * how OpenSCAD decides a variable is not customizable.
 */
function parseValue(raw) {
  const s = raw.trim();
  if (!s) return null;

  if (s === 'true') return { type: 'boolean', value: true };
  if (s === 'false') return { type: 'boolean', value: false };

  if (NUMBER_RE.test(s)) return { type: 'number', value: Number(s) };

  if (s.startsWith('"')) {
    const str = parseStringLiteral(s);
    return str === null ? null : { type: 'string', value: str };
  }

  if (s.startsWith('[') && s.endsWith(']')) {
    const parts = splitTopLevel(s.slice(1, -1));
    if (parts.length === 0) return null;
    const nums = [];
    for (const p of parts) {
      const t = p.trim();
      if (!NUMBER_RE.test(t)) return null;
      nums.push(Number(t));
    }
    if (nums.length < 1 || nums.length > 4) return null;
    return { type: 'vector', value: nums };
  }

  return null;
}

function parseStringLiteral(s) {
  if (s.length < 2 || s[0] !== '"') return null;
  let out = '';
  let i = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
      i += 2;
      continue;
    }
    if (c === '"') return i === s.length - 1 ? out : null;
    out += c;
    i++;
  }
  return null;
}

/** Split on commas that are not nested inside brackets or strings. */
function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\') {
        cur += s[++i] ?? '';
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === '[' || c === '(' || c === '{') depth++;
    if (c === ']' || c === ')' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Widget annotations
// ---------------------------------------------------------------------------

/**
 * Interpret a trailing `// [...]` comment.
 * Returns null when the comment is not an annotation, in which case the caller
 * treats it as free-text description instead.
 */
function parseAnnotation(text) {
  const m = /^\[(.*)\]$/s.exec(text.trim());
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return null;

  // Options list wins over range: `[1:one, 2:two]` contains ':' but is a list.
  if (inner.includes(',')) {
    const options = splitTopLevel(inner).map((part) => {
      const t = part.trim();
      const ci = t.indexOf(':');
      if (ci > 0) {
        const v = t.slice(0, ci).trim();
        return { value: coerceOption(v), label: t.slice(ci + 1).trim() };
      }
      return { value: coerceOption(t), label: t };
    });
    return { widget: 'options', options };
  }

  // `[file]`, or `[file svg]` / `[file:svg dxf]` to narrow the picker's filter.
  //
  // This is an addition to the Customizer syntax rather than part of it: the
  // spec has no file-path widget, and its two file-backed annotations
  // (image_surface, image_array) mean something narrower. OpenSCAD ignores an
  // annotation it does not recognise, so a model written this way still opens
  // and renders normally outside this app — the variable is simply a string.
  //
  // Checked after the options branch so a genuine dropdown whose first entry
  // happens to be labelled `file:` still parses as a dropdown.
  const file = /^file(?:[\s:]+(.*))?$/i.exec(inner);
  if (file) {
    return {
      widget: 'file',
      extensions: (file[1] || '')
        .split(/[\s,]+/)
        .map((e) => e.trim().replace(/^[.*]+/, '').toLowerCase())
        .filter(Boolean),
    };
  }

  if (inner.includes(':')) {
    const parts = inner.split(':').map((p) => p.trim());
    if (parts.length === 2 && parts.every(isNum)) {
      return { widget: 'range', min: Number(parts[0]), max: Number(parts[1]) };
    }
    if (parts.length === 3 && parts.every(isNum)) {
      return {
        widget: 'range',
        min: Number(parts[0]),
        step: Number(parts[1]),
        max: Number(parts[2]),
      };
    }
    // `value:Label` with a single entry is still a one-item dropdown.
    const ci = inner.indexOf(':');
    return {
      widget: 'options',
      options: [
        {
          value: coerceOption(inner.slice(0, ci).trim()),
          label: inner.slice(ci + 1).trim(),
        },
      ],
    };
  }

  if (isNum(inner)) return { widget: 'max', max: Number(inner) };

  const kw = inner.toLowerCase();
  if (RANGE_KEYWORDS.has(kw)) return { widget: kw };

  return { widget: 'options', options: [{ value: inner, label: inner }] };
}

function isNum(s) {
  return NUMBER_RE.test(s.trim());
}

function coerceOption(v) {
  const t = v.trim().replace(/^"|"$/g, '');
  return NUMBER_RE.test(t) ? Number(t) : t;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$/;

/**
 * CSS/SVG colour names, which is exactly what OpenSCAD's `color()` accepts as a
 * string. Models frequently write `base_color = "white"` rather than a hex
 * value, and without this those parameters would render as plain text boxes.
 * Mapped to hex so the swatch can show the right colour.
 */
const NAMED_COLOURS = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
  darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f', darkslateblue: '#483d8b', darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0',
  forestgreen: '#228b22', fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff',
  gold: '#ffd700', goldenrod: '#daa520', gray: '#808080', green: '#008000',
  greenyellow: '#adff2f', grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4',
  indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c',
  lavender: '#e6e6fa', lavenderblush: '#fff0f5', lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
  lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa',
  lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6',
  magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db',
  mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc', mediumvioletred: '#c71585', midnightblue: '#191970',
  mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead',
  navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23',
  orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa',
  palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb',
  plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', red: '#ff0000',
  rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072',
  sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d',
  silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090',
  slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4',
  tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
  turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff',
  whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

function namedColourHex(value) {
  return NAMED_COLOURS[String(value).trim().toLowerCase()] || null;
}

function isColourValue(value) {
  return HEX_COLOR_RE.test(value) || namedColourHex(value) !== null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const ASSIGN_RE = /^([A-Za-z_$][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/;

/**
 * @param {string} source .scad file contents
 * @returns {{parameters: Array, groups: Array<string>, plates: Array<number>, modules: Array<string>}}
 */
function parseCustomizer(source) {
  const items = scan(source);
  const parameters = [];
  const modules = [];
  const plates = new Set();
  const groupOrder = [];
  const includes = [];

  let currentGroup = 'Parameters';
  let hidden = false;
  let cutoff = false;
  let description = [];

  const noteGroup = (g) => {
    if (!groupOrder.includes(g)) groupOrder.push(g);
  };

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];

    // Pulling in a library does not end customizer scope — only a module or
    // function definition does — so parameters after an include still count.
    if (item.kind === 'include' || item.kind === 'use') {
      includes.push({ kind: item.kind, file: item.file });
      description = [];
      continue;
    }

    if (item.kind === 'module' || item.kind === 'function') {
      if (item.kind === 'module') {
        modules.push(item.name);
        const pm = /^mw_plate_(\d+)$/.exec(item.name);
        if (pm) plates.add(Number(pm[1]));
      }
      // Everything past the first definition is out of customizer scope.
      cutoff = true;
      description = [];
      continue;
    }

    if (item.kind === 'blockComment') {
      const gm = /^\[(.+)\]$/s.exec(item.text.trim());
      if (gm) {
        const name = gm[1].trim();
        if (/^hidden$/i.test(name)) {
          hidden = true;
        } else {
          hidden = false;
          currentGroup = name;
        }
        description = [];
      }
      continue;
    }

    if (item.kind === 'lineComment') {
      if (item.ownLine) description.push(item.text);
      continue;
    }

    // --- statement ---
    if (cutoff || hidden) {
      description = [];
      continue;
    }

    const am = ASSIGN_RE.exec(item.code.trim());
    if (!am) {
      description = [];
      continue;
    }

    const name = am[1];
    // `$fn` and friends are special variables; OpenSCAD keeps them out of the form.
    if (name.startsWith('$')) {
      description = [];
      continue;
    }

    const parsed = parseValue(am[2]);
    if (!parsed) {
      description = [];
      continue;
    }

    // A line comment on the same line as this statement is its annotation.
    let annotation = null;
    let trailingText = null;
    const next = items[idx + 1];
    if (next && next.kind === 'lineComment' && !next.ownLine && next.line === item.line) {
      annotation = parseAnnotation(next.text);
      if (!annotation) trailingText = next.text;
      idx++; // consumed
    }

    const desc = description.join(' ').trim() || trailingText || '';
    description = [];

    noteGroup(currentGroup);
    parameters.push(
      buildParameter({ name, group: currentGroup, description: desc, parsed, annotation })
    );
  }

  return {
    parameters,
    groups: groupOrder,
    plates: [...plates].sort((a, b) => a - b),
    modules,
    includes,
    // The leading path segment of each include is the library folder it needs,
    // which is what OPENSCADPATH has to contain for the model to render.
    requiredLibraries: [
      ...new Set(
        includes
          .map((i) => i.file.split('/')[0])
          .filter((f) => f && !f.startsWith('.') && f.includes('.') === false)
      ),
    ],
  };
}

function buildParameter({ name, group, description, parsed, annotation }) {
  const p = {
    name,
    group,
    description,
    type: parsed.type,
    default: parsed.value,
    widget: null,
  };

  if (annotation && annotation.widget === 'options') {
    p.widget = 'select';
    p.options = annotation.options;
    return p;
  }

  if (annotation && annotation.widget === 'color') {
    p.widget = 'color';
    return p;
  }

  // Only a string can hold a path, so a `[file]` on anything else falls through
  // to that type's usual widget rather than producing a picker that cannot
  // write its result back.
  if (annotation && annotation.widget === 'file' && parsed.type === 'string') {
    p.widget = 'file';
    if (annotation.extensions.length) p.extensions = annotation.extensions;
    return p;
  }

  if (annotation && (annotation.widget === 'image_surface' || annotation.widget === 'image_array')) {
    // File-backed widgets are not supported; degrade to a plain field so the
    // model still renders with its default.
    p.widget = parsed.type === 'string' ? 'text' : 'number';
    p.unsupported = annotation.widget;
    return p;
  }

  switch (parsed.type) {
    case 'boolean':
      p.widget = 'checkbox';
      break;

    case 'number':
      if (annotation && annotation.widget === 'range') {
        p.widget = 'slider';
        p.min = annotation.min;
        p.max = annotation.max;
        if (annotation.step !== undefined) p.step = annotation.step;
        else p.step = inferStep(annotation.min, annotation.max, parsed.value);
      } else if (annotation && annotation.widget === 'max') {
        p.widget = 'number';
        p.min = 0;
        p.max = annotation.max;
      } else {
        p.widget = 'number';
      }
      break;

    case 'string':
      if (isColourValue(parsed.value)) {
        p.widget = 'color';
        // The swatch needs hex; the value itself stays as written so a model
        // using named colours keeps reading naturally until the user edits it.
        p.swatch = namedColourHex(parsed.value) || parsed.value;
      } else if (annotation && annotation.widget === 'max') {
        p.widget = 'text';
        p.maxLength = annotation.max;
      } else {
        p.widget = 'text';
      }
      break;

    case 'vector':
      p.widget = 'vector';
      p.length = parsed.value.length;
      if (annotation && annotation.widget === 'range') {
        p.min = annotation.min;
        p.max = annotation.max;
        if (annotation.step !== undefined) p.step = annotation.step;
      }
      break;
  }

  return p;
}

/**
 * Pick a slider step when the annotation gave only min and max.
 * OpenSCAD uses integer steps for integer bounds, so match that, but keep a
 * finer step when the default value itself is fractional.
 */
function inferStep(min, max, value) {
  const allInt =
    Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(value);
  if (allInt) return 1;
  const span = Math.abs(max - min);
  if (span <= 1) return 0.01;
  if (span <= 10) return 0.1;
  return 0.5;
}

module.exports = {
  parseCustomizer,
  // exported for tests
  parseValue,
  parseAnnotation,
  splitTopLevel,
  scan,
  namedColourHex,
  isColourValue,
};
