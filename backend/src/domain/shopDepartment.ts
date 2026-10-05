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
    return "OTHER";
  }
  const d = text.toLowerCase();
  
  if (d.includes("[tire") || d.includes("tire shop") || d.includes("tires shop")) return "TIRE";
  if (d.includes("[muffler") || d.includes("muffler shop") || d.includes("mufflers shop")) return "MUFFLER";

  const isTire =
    d.includes("tire") ||
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

  const isMuffler =
    d.includes("muffler") ||
    d.includes("exhaust") ||
    d.includes("pipe") ||
    d.includes("weld") ||
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
    d.includes("manifold") ||
    d.includes("leak") ||
    d.includes("weep") ||
    d.includes("seal") ||
    d.includes("gasket") ||
    d.includes("belt") ||
    d.includes("serpentine") ||
    d.includes("engine") ||
    d.includes("motor") ||
    d.includes("transmission") ||
    d.includes("gearbox") ||
    d.includes("clutch") ||
    d.includes("battery") ||
    d.includes("hybrid") ||
    d.includes("no-start") ||
    d.includes("starter") ||
    d.includes("alternator") ||
    d.includes("coolant") ||
    d.includes("radiator") ||
    d.includes("thermostat") ||
    d.includes("water pump") ||
    d.includes("smell") ||
    d.includes("heating") ||
    d.includes("heater") ||
    d.includes("air condition") ||
    d.includes("ac compressor") ||
    d.includes("spark plug") ||
    d.includes("ignition");

  if (isTire && !isMuffler) return "TIRE";
  if (isMuffler && !isTire) return "MUFFLER";
  if (isTire && isMuffler) return "TIRE";

  if (fallbackSeed) {
    let hash = 0;
    for (let i = 0; i < fallbackSeed.length; i++) hash += fallbackSeed.charCodeAt(i);
    return hash % 2 === 0 ? "TIRE" : "MUFFLER";
  }

  return "OTHER";
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

  return classifyTextDepartment(line.description);
}

