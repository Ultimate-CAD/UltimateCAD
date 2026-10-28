import { describe, expect, it, vi } from "vitest";
import {
  CAD_MODIFIER_MAX_SHARP_ANGLE,
  CAD_MODIFIER_MAX_PREPARE_TIMEOUT_MS,
  CAD_MODIFIER_REQUEST_TIMEOUT_MS,
  CAD_MODIFIER_RUNTIME_BASE,
  cadModifierBaseDeflection,
  cadModifierCandidateEdge,
  cadModifierPrepareCostMs,
  cadModifierPrepareTimeoutMs,
  cadModifierTessellationDeflection,
  cadModifierCappedDeflection,
  cadModifierTopologyEdgeIsSelectable,
  cadTransformRequiresGeneralTransform,
  cadModifierTimeoutMessage,
  defaultCadModifierTangentChain,
  edgeModifierSelectionStatus,
  isCadModifierKernelExhausted,
  rescueSharpAngleForEdges,
  isCadModifierWasmMemoryFault,
  selectableCadModifierEdge,
  CAD_MODIFIER_KERNEL_RESTART_MESSAGE,
  SKETCH_CAD_DEFLECTION,
  cadModifierUserErrorMessage,
  VARIABLE_FILLET_ONE_EDGE_MESSAGE,
} from "@/lib/cadModifierRuntime";
import { setLanguage } from "@/lib/i18n";

describe("CAD modifier runtime state", () => {
  it("uses the build-managed OCCT runtime", () => {
    expect(CAD_MODIFIER_RUNTIME_BASE).toBe("/occt");
  });

  it("loads the kernel from a folder named after its version", async () => {
    // A cached kernel from an older release must never meet newer app code.
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_OCCT_RUNTIME_VERSION", "5.3.5-layerling.1");
    try {
      const runtime = await import("@/lib/cadModifierRuntime");
      expect(runtime.CAD_MODIFIER_RUNTIME_BASE).toBe("/occt/5.3.5-layerling.1");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("does not report zero edges before preparation finishes", () => {
    expect(edgeModifierSelectionStatus(false, 0, 0)).toBe("Preparing edges\u2026");
    expect(edgeModifierSelectionStatus(true, 0, 0)).toBe("0 of 0 sharp edges selected");
    expect(edgeModifierSelectionStatus(true, 2, 12)).toBe("2 of 12 sharp edges selected");
  });

  it("uses the normal request timeout and bounded linear mesh preparation allowance", () => {
    expect(CAD_MODIFIER_REQUEST_TIMEOUT_MS).toBe(120_000);
    expect(CAD_MODIFIER_MAX_PREPARE_TIMEOUT_MS).toBe(600_000);
    expect(cadModifierPrepareTimeoutMs(0)).toBe(CAD_MODIFIER_REQUEST_TIMEOUT_MS);
    expect(cadModifierPrepareTimeoutMs(Number.NaN)).toBe(CAD_MODIFIER_REQUEST_TIMEOUT_MS);
    expect(cadModifierPrepareCostMs(0)).toBe(1_000);
    expect(cadModifierPrepareCostMs(4_000)).toBe(11_000);
    expect(cadModifierPrepareCostMs(14_772)).toBe(37_930);
    expect(cadModifierPrepareCostMs(20_000)).toBe(51_000);
    expect(cadModifierPrepareCostMs(50_000)).toBe(126_000);
    expect(cadModifierPrepareCostMs(100_000)).toBe(251_000);
    // No triangle-count refusal: above the 60 s floor, the 2.5x linear estimate
    // gives these meshes their computed allowance up to the 10 minute cap.
    expect(cadModifierPrepareTimeoutMs(14_772)).toBe(94_825);
    expect(cadModifierPrepareTimeoutMs(20_000)).toBe(127_500);
    expect(cadModifierPrepareTimeoutMs(50_000)).toBe(315_000);
    expect(cadModifierPrepareTimeoutMs(100_000)).toBe(CAD_MODIFIER_MAX_PREPARE_TIMEOUT_MS);
    expect(cadModifierTimeoutMessage("prepare")).toContain("lower-detail STL");
    expect(cadModifierTimeoutMessage("prepare")).not.toContain("Firefox");
  });

  it("does not expose thresholds above the worker's folded edge-angle range", () => {
    expect(CAD_MODIFIER_MAX_SHARP_ANGLE).toBe(90);
  });

  it("recognizes browser-specific WebAssembly memory fault messages", () => {
    expect(isCadModifierWasmMemoryFault("toBREP: memory access out of bounds")).toBe(true);
    expect(isCadModifierWasmMemoryFault("toBREP: Out of bounds memory access (evaluating 'func(...args)')")).toBe(true);
    expect(isCadModifierWasmMemoryFault("Unreachable code reached", "RuntimeError")).toBe(true);
    expect(isCadModifierWasmMemoryFault("The selected edges cannot be filleted together", "Error")).toBe(false);
    expect(isCadModifierWasmMemoryFault("fillet: [object WebAssembly.Exception]", "OcctError")).toBe(false);
    expect(isCadModifierWasmMemoryFault("fillet: wasm exception", "OcctError")).toBe(false);
  });

  it("routes rotated non-uniform resize transforms through OCCT's general transform", () => {
    const angle = Math.PI / 4;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const rotatedNonUniformResize = [
      2 * cosine, 0, 2 * sine, 12,
      0, 1, 0, 4,
      -sine, 0, cosine, -8,
    ];
    const rigidRotation = [
      cosine, 0, sine, 12,
      0, 1, 0, 4,
      -sine, 0, cosine, -8,
    ];

    expect(cadTransformRequiresGeneralTransform(rotatedNonUniformResize)).toBe(true);
    expect(cadTransformRequiresGeneralTransform(rigidRotation)).toBe(false);
  });

  it("does not auto-chain newly created edges after an applied edge treatment", () => {
    expect(defaultCadModifierTangentChain(0)).toBe(true);
    expect(defaultCadModifierTangentChain(1)).toBe(false);
    expect(defaultCadModifierTangentChain(2)).toBe(false);
  });

  it("keeps valid post-treatment edges selectable when normal outline display suppresses them", () => {
    const hiddenDetailEdge = {
      display: false,
      selectable: true,
      manifold: true,
      boundary: false,
      angle: 45,
      points: [0, 0, 0, 1, 0, 0],
    };

    expect(cadModifierTopologyEdgeIsSelectable(hiddenDetailEdge)).toBe(true);
    expect(selectableCadModifierEdge(hiddenDetailEdge, 25)).toBe(true);
    expect(selectableCadModifierEdge(hiddenDetailEdge, 60)).toBe(false);
  });

  it("keeps a shallow-angle edge pickable independent of the sharp-angle slider (Forum: Verrundung erst nach Schieberegler)", () => {
    const shallowEdge = { selectable: true, manifold: true, boundary: false, angle: 8 };

    // Unter der Schwelle nicht in der Vorauswahl - aber grundsaetzlich verrundbar.
    expect(selectableCadModifierEdge(shallowEdge, 25)).toBe(false);
    expect(cadModifierCandidateEdge(shallowEdge)).toBe(true);
  });

  it("still excludes edges that are structurally unusable, not just below the threshold", () => {
    const nonManifoldEdge = { selectable: true, manifold: false, boundary: false, angle: 45 };
    const boundaryEdge = { selectable: true, manifold: true, boundary: true, angle: 45 };
    const unselectableEdge = { selectable: false, manifold: true, boundary: false, angle: 45 };

    expect(cadModifierCandidateEdge(nonManifoldEdge)).toBe(false);
    expect(cadModifierCandidateEdge(boundaryEdge)).toBe(false);
    expect(cadModifierCandidateEdge(unselectableEdge)).toBe(false);
  });
});

/*
 * Der Unterschied, um den es hier geht: "dieser Radius passt an dieser Kante
 * nicht" ist eine Aussage ueber das Bauteil - der Kernel arbeitet weiter. Eine
 * Ausnahme aus dem WebAssembly heraus ist eine Aussage ueber den Kernel, und
 * dann muss er abgebaut werden, sonst scheitert ab da alles.
 */
describe("Kernel am Ende oder nur die Aufgabe?", () => {
  it("erkennt eine Ausnahme aus dem WebAssembly als Kernel-Ende", () => {
    expect(isCadModifierKernelExhausted("fromBREP: [object WebAssembly.Exception]")).toBe(true);
  });

  it("erkennt auch den Speicherfehler weiterhin", () => {
    expect(isCadModifierKernelExhausted("memory access out of bounds")).toBe(true);
    expect(isCadModifierKernelExhausted("etwas ganz anderes", "RuntimeError")).toBe(true);
  });

  it("laesst eine gescheiterte Verrundung den Kernel nicht kosten", () => {
    expect(isCadModifierKernelExhausted("The chosen size creates invalid or overlapping edge geometry")).toBe(false);
    expect(isCadModifierKernelExhausted("The group has no solid body to modify")).toBe(false);
    expect(isCadModifierKernelExhausted("")).toBe(false);
  });

  it("meldet den Neustart mit einem Satz, der den Anwender nicht ratlos laesst", () => {
    expect(CAD_MODIFIER_KERNEL_RESTART_MESSAGE).toContain("restarted");
    expect(isCadModifierKernelExhausted(CAD_MODIFIER_KERNEL_RESTART_MESSAGE)).toBe(false);
  });
});

describe("cadModifierUserErrorMessage", () => {
  it("says a variable radius takes one edge, in German too (#687)", () => {
    setLanguage("de", false);
    expect(cadModifierUserErrorMessage(`Error: ${VARIABLE_FILLET_ONE_EDGE_MESSAGE}`)).toContain("eine Kante");
    setLanguage("en", false);
    expect(cadModifierUserErrorMessage(VARIABLE_FILLET_ONE_EDGE_MESSAGE)).toContain("one edge at a time");
  });

  it("translates overlapping geometry error into helpful German message", () => {
    setLanguage("de", false);
    const raw = "The chosen size creates invalid or overlapping edge geometry";
    const msg = cadModifierUserErrorMessage(raw);
    expect(msg).toContain("kleineren Wert");
  });

  it("translates overlapping geometry error into helpful English message", () => {
    setLanguage("en", false);
    const raw = "The chosen size creates invalid or overlapping edge geometry";
    const msg = cadModifierUserErrorMessage(raw);
    expect(msg).toContain("smaller value");
  });

  it("translates timeout and worker errors", () => {
    setLanguage("de", false);
    expect(cadModifierUserErrorMessage("The edge preview timed out. Cancel the tool and try again.")).toContain("Vorschau-Berechnung");
    expect(cadModifierUserErrorMessage("Edge preparation timed out. This mesh needs more CAD processing than the interactive limit allows. Try a repaired or lower-detail STL.")).toContain("Vorbereitung der Kanten");
    expect(cadModifierUserErrorMessage("The group has no solid body to modify")).toContain("keinen festen Körper");
    expect(cadModifierUserErrorMessage("The CAD worker could not start. Update to Firefox 121+, Chrome/Brave 114+, or Safari 17.2+, then try again.")).toContain("CAD-Rechenkern");
  });

  it("tells a body that cannot be hollowed from a wall that is too thick (forum 618422)", () => {
    setLanguage("de", false);
    const raw = "This body cannot be hollowed with any wall thickness.";
    expect(cadModifierUserErrorMessage(raw)).toContain("lässt sich nicht aushöhlen");
    expect(cadModifierUserErrorMessage(raw)).not.toContain("so dick");
    setLanguage("en", false);
    expect(cadModifierUserErrorMessage(raw)).toContain("cannot be hollowed, not even with a very thin wall");
    expect(cadModifierUserErrorMessage(raw)).not.toContain("thinner wall");
  });

  it("words the refusals of Delete face, from the worker and from the editor (#451)", () => {
    setLanguage("de", false);
    expect(cadModifierUserErrorMessage("These faces cannot be deleted: the faces around them do not close the gap.")).toContain("schließen die Lücke nicht");
    expect(cadModifierUserErrorMessage("This body has no exact faces to delete: layerling keeps it as a mesh, as it does an imported STL, OBJ or 3MF, a split, wrapped or simplified body, or a very detailed shape such as a long text. A part imported as STEP has exact faces.")).toContain("als Netz");
    expect(cadModifierUserErrorMessage("This body was resized with Keep edge size when resizing on and has no exact faces at this size; undo the resize, delete the faces, then resize it again")).toContain("Größenänderung rückgängig");
    expect(cadModifierUserErrorMessage("The faces of this body could not be read")).toContain("nicht gelesen werden");
    expect(cadModifierUserErrorMessage("Deleting these faces took too long and was stopped; the body is unchanged")).toContain("nach 45 Sekunden abgebrochen");
    setLanguage("en", false);
    expect(cadModifierUserErrorMessage("These faces cannot be deleted: the faces around them do not close the gap.")).toContain("Pick every face of what should go");
  });

  it("translates hollowing (shell) error messages into German and English", () => {
    setLanguage("de", false);
    expect(cadModifierUserErrorMessage("The walls cannot be this thick for this body. Choose a thinner wall.")).toBe(
      "Die Wände können für diesen Körper nicht so dick sein. Bitte eine dünnere Wandstärke wählen.",
    );
    expect(cadModifierUserErrorMessage("This body has no flat top face to leave open")).toContain("keine ebene Fläche");
    expect(cadModifierUserErrorMessage("This body has no flat bottom face to leave open")).toContain("keine ebene Fläche");
    expect(cadModifierUserErrorMessage("The object or project changed while it was being hollowed; try again")).toContain("geändert");

    setLanguage("en", false);
    expect(cadModifierUserErrorMessage("The walls cannot be this thick for this body. Choose a thinner wall.")).toBe(
      "The walls cannot be this thick for this body. Choose a thinner wall.",
    );
    expect(cadModifierUserErrorMessage("This body has no flat top face to leave open")).toContain("no flat top face");
    expect(cadModifierUserErrorMessage("This body has no flat bottom face to leave open")).toContain("no flat bottom face");
  });

  it("translates connected edge fillet/chamfer error messages", () => {
    setLanguage("de", false);
    expect(cadModifierUserErrorMessage("The selected edges cannot be filleted together at this size. Reduce the size or select fewer connected edges.")).toContain("verrundet werden");
    expect(cadModifierUserErrorMessage("The selected edges cannot be chamfered together at this size. Reduce the size or select fewer connected edges.")).toContain("angefast werden");

    setLanguage("en", false);
    expect(cadModifierUserErrorMessage("The selected edges cannot be filleted together at this size. Reduce the size or select fewer connected edges.")).toContain("filleted together");
  });

  it("passes through unknown errors and handles nullish values", () => {
    expect(cadModifierUserErrorMessage(null)).toBeNull();
    expect(cadModifierUserErrorMessage(undefined)).toBeNull();
    expect(cadModifierUserErrorMessage("Some unexpected error")).toBe("Some unexpected error");
  });
});

/*
 * Forenmeldung: ein Koerper aus einer Skizze mit mehreren nacheinander
 * angewandten Verrundungen bekommt zunehmend wellige Netzlinien. Ursache: jede
 * Verrundung tessellierte den GANZEN Koerper neu, aber die Feinheit hing nur
 * am Radius der jeweils neuen Operation - eine spaetere, groessere Verrundung
 * durfte eine schon fein vernetzte Stelle (z. B. eine Rundung der Skizze
 * selbst) groeber neu abtasten als sie schon war.
 */
describe("Vernetzungsfeinheit ueber mehrere Verrundungen hinweg", () => {
  it("deckelt die lineare Durchbiegung bei grossen Radien strikt, damit keine groben Facetten entstehen", () => {
    const gross = cadModifierBaseDeflection("standard", 10);
    const sehrGross = cadModifierBaseDeflection("standard", 25);
    expect(gross.linear).toBe(0.05);
    expect(sehrGross.linear).toBe(0.05);
    expect(cadModifierBaseDeflection("fine", 15).linear).toBe(0.025);
    expect(cadModifierBaseDeflection("draft", 15).linear).toBe(0.12);
  });

  it("skaliert bei winzigen Radien feiner herunter, bleibt aber nach unten abgesichert", () => {
    const winzig = cadModifierBaseDeflection("standard", 0.3);
    expect(winzig.linear).toBeLessThan(0.05);
    expect(winzig.linear).toBeGreaterThanOrEqual(0.01);
  });

  it("darf eine schon feinere Stelle nicht groeber ueberschreiben", () => {
    const fein = cadModifierBaseDeflection("fine", 0.5);
    const grob = cadModifierTessellationDeflection("standard", 8, fein);
    expect(grob.linear).toBe(fein.linear);
    // Nie groeber als die feinere Stelle - und auch nicht als die neue Operation selbst.
    expect(grob.angular).toBeLessThanOrEqual(fein.angular);
    expect(grob.angular).toBeLessThanOrEqual(cadModifierBaseDeflection("standard", 8).angular);
  });

  it("lässt eine tatsaechlich feinere neue Operation trotzdem gewinnen", () => {
    const standard = cadModifierBaseDeflection("standard", 8);
    const fine = cadModifierTessellationDeflection("fine", 1, standard);
    expect(fine.linear).toBeLessThan(standard.linear);
  });

  it("verhaelt sich ohne Vorgeschichte wie die Basis-Durchbiegung", () => {
    expect(cadModifierTessellationDeflection("standard", 2)).toEqual(cadModifierBaseDeflection("standard", 2));
  });

  it("laesst Behandlungen ab der Deckelung (Standard ab 1 mm) genau wie bisher", () => {
    [1, 2, 10].forEach((amount) => expect(cadModifierBaseDeflection("standard", amount)).toEqual({ linear: 0.05, angular: 0.16 }));
    [1, 5].forEach((amount) => expect(cadModifierBaseDeflection("fine", amount)).toEqual({ linear: 0.025, angular: 0.1 }));
    [1.2, 5].forEach((amount) => expect(cadModifierBaseDeflection("draft", amount)).toEqual({ linear: 0.12, angular: 0.35 }));
  });

  /*
   * Eine kleine Verrundung hat schon eine enge Sehne (0,01 mm bei 0,2 mm im
   * Standard); die feste Winkelgrenze von 0,16 rad schnitt jeden schmalen
   * Verrundungsstreifen zusaetzlich in zehn Reihen - "Grüße" mit 0,1 mm an
   * allen Kanten kam so im Editor auf 242.544 Dreiecke (jetzt 30.196).
   */
  it("lockert die Winkelgrenze, wenn die Sehne enger wird, bis zum OCCT-Standard von 0,5 rad", () => {
    expect(cadModifierBaseDeflection("standard", 0.1)).toEqual({ linear: 0.01, angular: 0.5 });
    expect(cadModifierBaseDeflection("standard", 0.5).linear).toBe(0.025);
    expect(cadModifierBaseDeflection("standard", 0.5).angular).toBeCloseTo(0.32, 12);
    (["draft", "standard", "fine"] as const).forEach((quality) => {
      const cap = cadModifierBaseDeflection(quality, 50);
      [0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 3].forEach((amount) => {
        const deflection = cadModifierBaseDeflection(quality, amount);
        expect(deflection.angular).toBeGreaterThanOrEqual(cap.angular);
        expect(deflection.angular).toBeLessThanOrEqual(0.5);
        // Unterhalb von 0,5 rad bleibt Winkel x Sehne beim Wert der Deckelung.
        if (deflection.angular < 0.5) expect(deflection.angular * deflection.linear).toBeCloseTo(cap.angular * cap.linear, 12);
      });
    });
  });

  it("wird nach einer grossen Behandlung auf einer kleinen wieder so fein wie bisher", () => {
    const klein = cadModifierBaseDeflection("standard", 0.1);
    expect(cadModifierTessellationDeflection("standard", 2, klein)).toEqual({ linear: 0.01, angular: 0.16 });
  });

  /*
   * Auf einem Torus - einer Verrundung um eine Kreiskante - haelt OCCT die
   * Sehne mit dem lockeren Winkel nicht immer ein; dann vernetzt das
   * Kantenwerkzeug mit der Winkelgrenze der Deckelung, also genau wie bisher.
   */
  it("liefert als Rueckfall die Winkelgrenze der Deckelung bei gleicher Sehne", () => {
    expect(cadModifierCappedDeflection("standard", cadModifierBaseDeflection("standard", 0.1))).toEqual({ linear: 0.01, angular: 0.16 });
    expect(cadModifierCappedDeflection("fine", cadModifierBaseDeflection("fine", 0.1))).toEqual({ linear: 0.005, angular: 0.1 });
    expect(cadModifierCappedDeflection("draft", cadModifierBaseDeflection("draft", 0.1))).toEqual({ linear: 0.03, angular: 0.35 });
    // Nie lockerer als das, was schon feststand.
    expect(cadModifierCappedDeflection("standard", { linear: 0.005, angular: 0.1 })).toEqual({ linear: 0.005, angular: 0.1 });
    expect(cadModifierCappedDeflection("toString" as "standard", { linear: 0.01, angular: 0.5 })).toEqual({ linear: 0.01, angular: 0.16 });
  });

  it("nimmt fuer unbekannte Qualitaeten den Standard, auch fuer Namen wie toString", () => {
    ["toString", "constructor", "__proto__", "irgendwas"].forEach((quality) => {
      expect(cadModifierBaseDeflection(quality as "standard", 0.1)).toEqual(cadModifierBaseDeflection("standard", 0.1));
    });
  });

  it("harmonisiert in der Standardvorgabe mit der feinen Skizzen-Tessellierung", () => {
    expect(cadModifierBaseDeflection("standard", 5).linear).toBeLessThanOrEqual(SKETCH_CAD_DEFLECTION.linear);
  });
});

/*
 * Wer ein Bauteil mit lauter flachen Uebergaengen oeffnet, sieht bei 25 Grad
 * nichts hervorgehoben und denkt, das Werkzeug koenne nur rechte Winkel. Die
 * Schwelle soll dann dorthin rutschen, wo die schaerfste Kante wirklich liegt.
 */
describe("Rettungsschwelle fuer flache Kanten", () => {
  const kante = (angle: number, extra: Partial<{ manifold: boolean; boundary: boolean; selectable: boolean }> = {}) => ({
    angle,
    manifold: true,
    boundary: false,
    selectable: true,
    ...extra,
  });

  it("laesst die Schwelle stehen, wenn ohnehin etwas waehlbar ist", () => {
    expect(rescueSharpAngleForEdges([kante(90), kante(12)], 25)).toBeNull();
  });

  it("rutscht auf die schaerfste vorhandene Kante", () => {
    expect(rescueSharpAngleForEdges([kante(12.7), kante(8), kante(3)], 25)).toBe(12);
  });

  it("zaehlt nur Kanten, die ueberhaupt bearbeitbar sind", () => {
    const kanten = [kante(20, { manifold: false }), kante(18, { boundary: true }), kante(15, { selectable: false }), kante(6)];
    expect(rescueSharpAngleForEdges(kanten, 25)).toBe(6);
  });

  it("rettet nichts, wo nur tangentiale Uebergaenge sind", () => {
    expect(rescueSharpAngleForEdges([kante(0.2), kante(0)], 25)).toBeNull();
    expect(rescueSharpAngleForEdges([], 25)).toBeNull();
  });
});
