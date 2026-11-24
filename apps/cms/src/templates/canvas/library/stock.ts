/**
 * General-purpose stock photos for the Design template library — free
 * Unsplash-licensed images bundled in public/media/stock (credits in
 * CREDITS.md there). Templates use these instead of our own portfolio shots
 * so every design reads as a neutral starting point.
 */
export const STOCK = {
  autumn: "autumn",
  balcony: "balcony",
  balloon: "balloon",
  benchFriends: "bench-friends",
  bokeh: "bokeh",
  book: "book",
  cafePlants: "cafe-plants",
  cafeTables: "cafe-tables",
  camera: "camera",
  camperVan: "camper-van",
  campus: "campus",
  cityNight: "city-night",
  cityStreet: "city-street",
  coffee: "coffee",
  concert: "concert",
  coworking: "coworking",
  deskTop: "desk-top",
  flatlay: "flatlay",
  forest: "forest",
  gadgets: "gadgets",
  heels: "heels",
  honey: "honey",
  kitchen: "kitchen",
  laptopCoffee: "laptop-coffee",
  laptopTyping: "laptop-typing",
  lightShaft: "light-shaft",
  meeting: "meeting",
  notes: "notes",
  phone: "phone",
  phoneLaptop: "phone-laptop",
  photographer: "photographer",
  picnic: "picnic",
  portraitField: "portrait-field",
  portraitSunset: "portrait-sunset",
  skyline: "skyline",
  stringLights: "string-lights",
  studioDesk: "studio-desk",
  sunset: "sunset",
  tea: "tea",
  workspace: "workspace",
} as const;

export type StockKey = keyof typeof STOCK;

export const stock = (k: StockKey) => `/media/stock/${STOCK[k]}.jpg`;
export const pics = (...keys: StockKey[]) => keys.map(stock);
