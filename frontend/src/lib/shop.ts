/**
 * The shop's public details, shown on the website and printed on receipts.
 *
 * Edit this one file to change what customers see. Only facts the owner has
 * confirmed belong here: no invented hours, ratings or reviews.
 */
export const SHOP = {
  name: "Mark's Tire Shop & Muffler",
  legalName: "Mark's Tire Shop & Muffler LLC",
  tagline: "Exhaust, muffler and tire service in New Orleans",
  phone: "(504) 354-9396",
  phoneHref: "tel:+15043549396",
  address: {
    line1: "5229 Saint Claude Ave",
    city: "New Orleans",
    state: "LA",
    postalCode: "70117",
  },
  mapsUrl:
    "https://www.google.com/maps/search/?api=1&query=5229+Saint+Claude+Ave+New+Orleans+LA+70117",
} as const;

export const SHOP_ADDRESS_LINE = `${SHOP.address.line1}, ${SHOP.address.city}, ${SHOP.address.state} ${SHOP.address.postalCode}`;

/** What the booking form offers, and what the website lists. */
export const SERVICES = [
  {
    id: "muffler",
    title: "Muffler & exhaust repair",
    body: "Loud rattle, hole or leak? We replace mufflers, pipes, hangers and clamps.",
    icon: "exhaust",
  },
  {
    id: "catalytic",
    title: "Catalytic converters",
    body: "Replacement converters for a failed emissions test or a stolen cat.",
    icon: "converter",
  },
  {
    id: "tires",
    title: "Tire sales & installation",
    body: "New tires mounted and balanced while you wait.",
    icon: "tire",
  },
  {
    id: "flat",
    title: "Flat tire repair",
    body: "Plugs and patches to get you back on the road.",
    icon: "repair",
  },
  {
    id: "balance",
    title: "Mount, balance & rotation",
    body: "Smooth out vibration and even out tire wear.",
    icon: "balance",
  },
  {
    id: "other",
    title: "Something else",
    body: "Not sure what the noise is? Tell us and we will take a look.",
    icon: "question",
  },
] as const;
