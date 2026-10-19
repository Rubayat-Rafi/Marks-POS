/**
 * Classifies items, lines and transactions into Tire Shop vs Mufflers Shop departments.
 */

export type ShopDepartment = "TIRE" | "MUFFLER" | "OTHER";

export function classifyTextDepartment(text?: string | null, fallbackSeed?: string): ShopDepartment {
  if (!text) {
    if (fallbackSeed) {
      let hash = 0;
      for (let i = 0; i < fallbackSeed.length; i++) hash += fallbackSeed.charCodeAt(i);
      return hash % 2 === 0 ? "TIRE" : "MUFFLER";
    }
    return "TIRE";
  }
  const d = text.toLowerCase();
  
  if (d.includes("[tire") || d.includes("tire shop") || d.includes("tires shop")) return "TIRE";
  if (d.includes("[muffler") || d.includes("muffler shop") || d.includes("mufflers shop")) return "MUFFLER";

  const isMuffler =
    d.includes("muffler") ||
    d.includes("exhaust") ||
    d.includes("pipe") ||
    d.includes("weld") ||
    d.includes("wald") ||
    /\b(mf|muff)\b/.test(d) ||
    d.includes("catalytic") ||
    d.includes("converter") ||
    d.includes("tailpipe") ||
    d.includes("flowmaster") ||
    d.includes("magnaflow") ||
    d.includes("cherry bomb") ||
    d.includes("walker") ||
    d.includes("resonator") ||
    d.includes("flex pipe") ||
    d.includes("header") ||
    d.includes("manifold");

  // Check tire sizes (e.g. 205/55R16, 225/65/17, 245/70-17, 31x10.50, 205 55 16)
  const isTireSize = /\b(?:\d{3}[\/\-\s]\d{2,3}(?:[rR]\d{2})?|\d{2,3}[\/\-]\d{2})\b/.test(d);

  // Common tire brands
  const isTireBrand =
    d.includes("michelin") ||
    d.includes("goodyear") ||
    d.includes("bridgestone") ||
    d.includes("continental") ||
    d.includes("pirelli") ||
    d.includes("firestone") ||
    d.includes("bfgoodrich") ||
    d.includes("yokohama") ||
    d.includes("hankook") ||
    d.includes("cooper") ||
    d.includes("falken") ||
    d.includes("toyo") ||
    d.includes("kumho") ||
    d.includes("general tire") ||
    d.includes("nexen") ||
    d.includes("starfire") ||
    d.includes("ironman") ||
    d.includes("linglong") ||
    d.includes("westlake");

  const isTire =
    isTireSize ||
    isTireBrand ||
    d.includes("tire") ||
    d.includes("tier") ||
    d.includes("tari") ||
    d.includes("tyre") ||
    d.includes("mount") ||
    d.includes("balance") ||
    d.includes("rotation") ||
    d.includes("flat") ||
    d.includes("alignment") ||
    d.includes("wheel") ||
    d.includes("rim") ||
    d.includes("tread") ||
    d.includes("tpms") ||
    d.includes("puncture") ||
    d.includes("bead") ||
    d.includes("patch") ||
    d.includes("valve") ||
    d.includes("stud") ||
    d.includes("lug") ||
    d.includes("hub") ||
    d.includes("suspension") ||
    d.includes("strut") ||
    d.includes("shock") ||
    d.includes("brake") ||
    d.includes("pad") ||
    d.includes("rotor") ||
    d.includes("caliper") ||
    d.includes("abs") ||
    d.includes("fleet") ||
    d.includes("maintenance") ||
    d.includes("lube") ||
    d.includes("oil") ||
    d.includes("fluid") ||
    d.includes("filter") ||
    d.includes("wiper") ||
    d.includes("inspection");

  if (isMuffler && !isTire) return "MUFFLER";
  if (isTire && !isMuffler) return "TIRE";
  if (isMuffler && isTire) return "TIRE";

  // In Mark's Tire Shop & Muffler LLC, all general shop services and parts default to TIRE
  return "TIRE";
}

export function classifyLineDepartment(line: {
  description: string;
  department?: string | null;
  inventoryUnits?: Array<{ product?: { kind: string } | null }>;
}): ShopDepartment {
  if (line.department === "TIRE" || line.department === "MUFFLER") {
    return line.department;
  }

  if (line.inventoryUnits && line.inventoryUnits.length > 0) {
    for (const u of line.inventoryUnits) {
      if (u.product?.kind === "TIRE") return "TIRE";
      if (u.product?.kind === "MUFFLER") return "MUFFLER";
    }
  }

  const dept = classifyTextDepartment(line.description);
  return dept === "MUFFLER" ? "MUFFLER" : "TIRE";
}

