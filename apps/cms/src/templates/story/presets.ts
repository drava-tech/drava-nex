import { CANVAS_FONTS } from "@platform/ui/templates/canvas";
import {
  blankStory,
  makeApp,
  makeFilter,
  storyId,
  type StoryBrand,
  type StoryContent,
  type StoryFilter,
  type StoryHotspot,
  type StoryApp,
  type StoryAppKind,
  type StoryMapPin,
  type StoryMapRegion,
  type StoryVideoChapter,
  type StoryMedia,
  type StoryShowcaseItem,
  type StoryTimelineEvent,
} from "@platform/ui/templates/story";
import { sampleStory } from "./sample";

/**
 * Starter stories for history walls. Each one is a complete, themed experience
 * (palette, type, idle loop, menu and apps) filled with placeholder copy that
 * reads like the real thing, so an operator swaps in their own dates, names and
 * archive photos instead of designing from nothing.
 *
 * Fonts come from CANVAS_FONTS, which are bundled locally (see
 * templates/canvas/fonts.ts), so they render the same on an offline wall.
 */
export interface StoryPreset {
  id: string;
  label: string;
  description: string;
  /** Name given to the story when the operator leaves the name blank. */
  defaultName: string;
  build: (width: number, height: number) => StoryContent;
}

const F = Object.fromEntries(CANVAS_FONTS.map((f) => [f.label, f.value])) as Record<string, string>;

const IMG = {
  centre: "/media/experience-center.png",
  brand: "/media/brand-experiences.png",
  interior: "/media/interior-space.png",
};

// ─── Small builders, so each preset reads as content rather than plumbing ────

const img = (url: string): StoryMedia => ({ id: storyId(), type: "image", url });
const media = (url?: string | null): StoryMedia[] => (url ? [img(url)] : []);

function ev(
  year: number,
  filter: StoryFilter | null,
  title: string,
  subtitle: string,
  body: string,
  opts: { dateLabel?: string; image?: string } = {}
): StoryTimelineEvent {
  return {
    id: storyId(),
    year,
    dateLabel: opts.dateLabel ?? "",
    filterId: filter?.id ?? null,
    title,
    subtitle,
    body,
    media: media(opts.image),
  };
}

function pin(x: number, y: number, filter: StoryFilter | null, title: string, subtitle: string, body: string, image?: string): StoryMapPin {
  return { id: storyId(), x, y, filterId: filter?.id ?? null, title, subtitle, body, media: media(image) };
}

function item(filter: StoryFilter | null, title: string, subtitle: string, body: string, cover?: string): StoryShowcaseItem {
  return { id: storyId(), filterId: filter?.id ?? null, coverUrl: cover ?? null, title, subtitle, body, media: media(cover) };
}

function spot(x: number, y: number, title: string, subtitle: string, body: string): StoryHotspot {
  return { id: storyId(), x, y, title, subtitle, body, media: [] };
}

function region(points: [number, number][], filter: StoryFilter | null, title: string, subtitle: string, body: string): StoryMapRegion {
  return { id: storyId(), points: points.map(([x, y]) => ({ x, y })), filterId: filter?.id ?? null, title, subtitle, body, media: [] };
}

/** A narrated chapter: the poster is the photo the voice-over will play over. */
function chapter(title: string, subtitle: string, transcript: string, poster?: string): StoryVideoChapter {
  return { id: storyId(), title, subtitle, body: transcript, media: [], videoUrl: null, posterUrl: poster ?? null, voiceUrl: null };
}

function videoApp(title: string, tagline: string, coverUrl: string | null, chapters: StoryVideoChapter[]): StoryApp {
  return { id: storyId(), kind: "video", title, tagline, coverUrl, autoAdvance: true, chapters };
}

function base(width: number, height: number, brand: Partial<StoryBrand>): StoryContent {
  const s = blankStory(width, height);
  s.brand = { ...s.brand, ...brand };
  return s;
}

function slide(headline: string, body: string, mediaUrl: string | null = null) {
  return { id: storyId(), mediaUrl, mediaType: "image" as const, headline, body };
}

// ─── Presets ──────────────────────────────────────────────────────────────────

/** Fifty-year company heritage: archival cream, serif type, brass accent. */
function heritage(W: number, H: number): StoryContent {
  const s = base(W, H, {
    background: "#f3ece0",
    surface: "#fbf7f0",
    text: "#2b2118",
    muted: "#7a6a58",
    accent: "#a8742c",
    accentText: "#fbf7f0",
    headingFont: F["Gelasio"],
    bodyFont: F["Arimo"],
    radius: 4,
  });
  s.idle.prompt = "Touch to step back in time";
  s.idle.slides = [
    slide("Since 1974", "Fifty years of craft, built one project at a time.", IMG.interior),
    slide("It started in a single workshop", "Three people, one lathe and a promise to do it properly.", IMG.centre),
    slide("Explore our heritage", "Touch the screen to walk through five decades."),
  ];
  s.home = { headline: "Our Heritage", subheadline: "Five decades of craft · 1974 – today", backgroundUrl: null };

  const d70 = makeFilter("1970s", "#a8742c");
  const d80 = makeFilter("1980s", "#8a5a2b");
  const d90 = makeFilter("1990s", "#6b7b4b");
  const d00 = makeFilter("2000s", "#4b6b7b");
  const now = makeFilter("Today", "#2b2118");
  const founders = makeFilter("Founders");
  const makers = makeFilter("Makers");
  const leaders = makeFilter("Leaders");
  const plants = makeFilter("Workshops", "#a8742c");
  const showrooms = makeFilter("Showrooms", "#6b7b4b");

  s.apps = [
    {
      id: storyId(),
      kind: "timeline",
      title: "Five decades",
      tagline: "The moments that made us",
      coverUrl: IMG.interior,
      filters: [d70, d80, d90, d00, now],
      events: [
        ev(1974, d70, "The first workshop", "A rented shed on the edge of town", "Our founders opened the doors with three people, one lathe and a handshake deal with a local builder.", { image: IMG.interior }),
        ev(1979, d70, "First commission", "The town hall restoration", "A restoration job nobody else wanted became the project that put our name on the map."),
        ev(1983, d80, "Moving up", "A purpose-built workshop", "Forty craftspeople, a new building and our first apprenticeship programme."),
        ev(1988, d80, "The family grows", "Second generation joins", "The founders' children joined the floor — starting, like everyone, as apprentices."),
        ev(1994, d90, "Beyond the region", "First national contract", "Work for clients across the country, delivered from the same workshop."),
        ev(1999, d90, "A new millennium", "Investing in design", "We opened our own design studio so ideas and making happen under one roof."),
        ev(2006, d00, "First showroom", "Seeing is believing", "A showroom where clients could touch the materials before they chose them.", { image: IMG.centre }),
        ev(2012, d00, "Recognised", "National craftsmanship award", "Our restoration of the old library was named project of the year."),
        ev(2019, now, "Sustainable by design", "Every material traced", "We committed to sourcing every timber and stone from certified suppliers."),
        ev(2024, now, "Fifty years", "Still made by hand", "Three hundred people, three generations and the same promise.", { dateLabel: "Today", image: IMG.brand }),
      ],
    },
    {
      id: storyId(),
      kind: "showcase",
      title: "The people",
      tagline: "Founders, makers and leaders",
      coverUrl: null,
      filters: [founders, makers, leaders],
      items: [
        item(founders, "Founder name", "Co-founder · 1974", "Trained as a carpenter, started the business with savings from ten years on building sites."),
        item(founders, "Founder name", "Co-founder · 1974", "Ran the books, the clients and — for the first five years — the delivery van."),
        item(makers, "Master craftsperson", "With us since 1981", "Has trained more than two hundred apprentices on the workshop floor."),
        item(makers, "Head of restoration", "With us since 1996", "Led the library restoration that won our first national award."),
        item(leaders, "Managing director", "Second generation", "Joined as an apprentice in 1988 and has led the company since 2010."),
        item(leaders, "Design director", "Since 2015", "Built the design studio into a team of thirty."),
      ],
    },
    {
      id: storyId(),
      kind: "map",
      title: "How we grew",
      tagline: "Follow the journey from one town to the whole country",
      coverUrl: null,
      mapUrl: null,
      mode: "journey",
      dial: true,
      regions: [],
      filters: [plants, showrooms],
      pins: [
        pin(30, 55, plants, "The original workshop", "Workshops · 1974", "Where it all began. Still in use today for restoration work."),
        pin(34, 50, plants, "Main workshop", "Workshops · 1983", "Our largest site, home to the apprenticeship school."),
        pin(55, 35, showrooms, "City showroom", "Showrooms · 2006", "Our first showroom, opened in the old market building."),
        pin(72, 62, showrooms, "Coastal showroom", "Showrooms · 2017", "Serving clients across the south."),
      ],
    },
    {
      id: storyId(),
      kind: "hotspots",
      title: "Inside the workshop",
      tagline: "Tap to discover how it's made",
      coverUrl: IMG.interior,
      imageUrl: IMG.interior,
      hotspots: [
        spot(24, 42, "The original lathe", "1974", "The first machine we ever bought. Restored, and still turned on every anniversary."),
        spot(52, 58, "Hand finishing", "Every piece", "Each surface is finished by hand — the step we have never automated."),
        spot(78, 36, "The timber store", "Sourcing", "Every board here is traced back to the forest it came from."),
      ],
    },
    videoApp("Voices of the workshop", "Our people, in their own words", IMG.interior, [
      chapter("The first day", "Founder · 1974", "We had one lathe, a leaking roof and more confidence than sense. Replace this with the founder's own words, and add their recording as the voice-over.", IMG.interior),
      chapter("Learning the trade", "Master craftsperson · since 1981", "I came in as an apprentice at sixteen. The first thing they taught me was to sweep the floor — the second was why it mattered.", IMG.centre),
      chapter("Fifty years on", "Managing director", "Every new joiner still spends their first week on the workshop floor. That's not tradition — it's how we keep the promise.", IMG.brand),
    ]),
  ];
  return s;
}

/** Milestone anniversary: midnight and gold, bold expanded headings. */
function anniversary(W: number, H: number): StoryContent {
  const s = base(W, H, {
    background: "#0a1024",
    surface: "#141c38",
    text: "#f7f3e8",
    muted: "#a3a9c2",
    accent: "#e8c36a",
    accentText: "#0a1024",
    headingFont: F["Archivo Expanded"],
    bodyFont: F["Inter"],
    radius: 14,
  });
  s.idle.prompt = "Touch to celebrate with us";
  s.idle.slides = [
    slide("25 years", "A quarter century of firsts.", IMG.brand),
    slide("Thank you", "To every customer, partner and colleague who got us here.", IMG.centre),
    slide("Celebrate with us", "Touch to explore twenty-five years in twenty-five moments."),
  ];
  s.home = { headline: "25 Years", subheadline: "1999 – 2024 · Tap to explore", backgroundUrl: null };

  const start = makeFilter("Start-up", "#e8c36a");
  const scale = makeFilter("Scale-up", "#7aa2ff");
  const lead = makeFilter("Leadership", "#f08aa8");
  const products = makeFilter("Products");
  const people = makeFilter("People");
  const community = makeFilter("Community");

  s.apps = [
    {
      id: storyId(),
      kind: "timeline",
      title: "25 years in 25 moments",
      tagline: "Every milestone, year by year",
      coverUrl: IMG.brand,
      filters: [start, scale, lead],
      events: [
        ev(1999, start, "Day one", "A garage and a whiteboard", "Two founders, one idea and a whiteboard that still hangs in reception."),
        ev(2001, start, "First customer", "Contract number 0001", "A local retailer took a chance on us. They're still a customer today."),
        ev(2004, start, "First hire", "The team of ten", "We moved out of the garage and into a real office."),
        ev(2008, scale, "Through the storm", "No layoffs", "In the hardest year for our industry, we kept every job and doubled down on product."),
        ev(2011, scale, "Going international", "Our first overseas office", "A second office and our first customers abroad.", { image: IMG.centre }),
        ev(2015, scale, "1,000 customers", "A milestone worth a party", "One thousand customers in fifteen countries."),
        ev(2018, lead, "Industry first", "A product nobody had built", "We launched the platform that now powers most of what we do.", { image: IMG.brand }),
        ev(2021, lead, "Best place to work", "Voted by our people", "Recognised as one of the country's best places to work."),
        ev(2024, lead, "Twenty-five", "And just getting started", "Five hundred people, three continents, one whiteboard.", { dateLabel: "Today" }),
      ],
    },
    {
      id: storyId(),
      kind: "showcase",
      title: "Our firsts",
      tagline: "Products, people and proud moments",
      coverUrl: null,
      filters: [products, people, community],
      items: [
        item(products, "Version 1.0", "Products · 2001", "Built in six months, shipped on a CD, sold to one customer."),
        item(products, "The platform", "Products · 2018", "The product that changed what our customers expected from us.", IMG.brand),
        item(people, "First apprentice", "People · 2005", "Now our chief technology officer."),
        item(people, "500th colleague", "People · 2023", "Welcomed on their first day by both founders."),
        item(community, "Community fund", "Community · 2012", "Ten percent of profits to local education, every year since."),
        item(community, "Volunteer days", "Community · 2016", "Twenty thousand hours given back so far."),
      ],
    },
    {
      id: storyId(),
      kind: "map",
      title: "Around the world",
      tagline: "Offices and customers on three continents",
      coverUrl: null,
      mapUrl: null,
      mode: "pins",
      dial: true,
      regions: [],
      filters: [start, scale, lead],
      pins: [
        pin(47, 30, start, "Headquarters", "Since 1999", "Where it all began — and where the whiteboard lives."),
        pin(22, 38, scale, "Americas office", "Since 2011", "Our first office outside home."),
        pin(70, 45, lead, "Asia-Pacific office", "Since 2019", "Our fastest-growing team."),
        pin(52, 62, lead, "Innovation lab", "Since 2021", "Where the next twenty-five years are being built."),
      ],
    },
  ];
  return s;
}

/** A founder's life and legacy: black and white, editorial serif, square corners. */
function legacy(W: number, H: number): StoryContent {
  const s = base(W, H, {
    background: "#0d0d0d",
    surface: "#1a1a1a",
    text: "#f2f0eb",
    muted: "#9b978e",
    accent: "#f2f0eb",
    accentText: "#0d0d0d",
    headingFont: F["Tinos"],
    bodyFont: F["Inter"],
    radius: 0,
  });
  s.idle.prompt = "Touch to discover their story";
  s.idle.slides = [
    slide("A life of purpose", "1932 – 2015", IMG.centre),
    slide("“Build things that outlast you.”", "— Our founder"),
    slide("Their legacy lives on", "Touch the screen to explore."),
  ];
  s.home = { headline: "A Legacy", subheadline: "The life and work of our founder", backgroundUrl: null };

  const early = makeFilter("Early life", "#c9c3b6");
  const building = makeFilter("Building", "#d9b26b");
  const giving = makeFilter("Legacy", "#8fb3a8");
  const quotes = makeFilter("In their words");
  const honours = makeFilter("Honours");

  s.apps = [
    {
      id: storyId(),
      kind: "timeline",
      title: "A life in chapters",
      tagline: "From a small village to a lasting legacy",
      coverUrl: IMG.centre,
      filters: [early, building, giving],
      events: [
        ev(1932, early, "Born", "A village by the river", "The youngest of five, raised in a family of farmers and storytellers."),
        ev(1950, early, "Leaving home", "A scholarship to the city", "The first in the family to go to university — on a borrowed suit and a scholarship."),
        ev(1958, building, "The first venture", "A business of one", "Started with a single machine in a rented room."),
        ev(1967, building, "The company is born", "Incorporated", "The business took the name it carries today."),
        ev(1980, building, "A thousand jobs", "Growing a town", "The company became the largest employer in the region.", { image: IMG.interior }),
        ev(1992, giving, "The foundation", "Giving back", "A foundation for education, funded with half of the founder's shares."),
        ev(2005, giving, "Passing the torch", "Stepping down", "Handed leadership to the next generation, staying on as a mentor."),
        ev(2015, giving, "Remembered", "1932 – 2015", "Their foundation has since put over ten thousand students through school.", { dateLabel: "2015" }),
      ],
    },
    {
      id: storyId(),
      kind: "showcase",
      title: "In their words",
      tagline: "Letters, speeches and sayings",
      coverUrl: null,
      filters: [quotes, honours],
      items: [
        item(quotes, "“Build things that outlast you.”", "Speech to graduates · 1994", "Replace with a favourite quote, and the story of when it was said."),
        item(quotes, "“Every person here is a reason to keep going.”", "Letter to employees · 1981", "Written during the hardest year in the company's history."),
        item(quotes, "“Start before you're ready.”", "Interview · 2002", "Their most-repeated advice to young founders."),
        item(honours, "Honorary doctorate", "1998", "For services to industry and education."),
        item(honours, "Lifetime achievement", "2010", "Presented by the national chamber of commerce."),
      ],
    },
    {
      id: storyId(),
      kind: "hotspots",
      title: "The study",
      tagline: "Objects from a lifetime",
      coverUrl: IMG.interior,
      imageUrl: IMG.interior,
      hotspots: [
        spot(28, 46, "The writing desk", "1958", "Every early contract was signed here."),
        spot(55, 32, "The bookshelf", "Over 3,000 books", "Every one read, many annotated in the margins."),
        spot(74, 60, "The first machine", "1958", "Kept for sixty years as a reminder of where it began."),
      ],
    },
    videoApp("In their own voice", "Recordings from the archive", IMG.centre, [
      chapter("On starting out", "Radio interview · 1971", "Replace with a transcript of the recording. Add the archive audio as the voice-over and a photo from the same year.", IMG.centre),
      chapter("On the people", "Speech to employees · 1981", "“Every person here is a reason to keep going.” Add the full speech recording here.", IMG.interior),
      chapter("On what lasts", "Graduation address · 1994", "“Build things that outlast you.” The speech our foundation is named after.", IMG.brand),
    ]),
  ];
  return s;
}

/** City or museum heritage: parchment and terracotta, a landmark map, artefacts. */
function cityHeritage(W: number, H: number): StoryContent {
  const s = base(W, H, {
    background: "#efe6d6",
    surface: "#f8f2e7",
    text: "#2e1f17",
    muted: "#806a5a",
    accent: "#b4532a",
    accentText: "#f8f2e7",
    headingFont: F["Caladea"],
    bodyFont: F["Carlito"],
    radius: 10,
  });
  s.idle.prompt = "Touch to explore the city's past";
  s.idle.slides = [
    slide("A thousand years of history", "One city, many stories.", IMG.interior),
    slide("Walk through time", "Kingdoms, trade routes and the people who built them.", IMG.centre),
    slide("Explore", "Touch to begin."),
  ];
  s.home = { headline: "Stories of the City", subheadline: "A thousand years in one wall", backgroundUrl: null };

  const ancient = makeFilter("Ancient", "#b4532a");
  const medieval = makeFilter("Medieval", "#8c6d3f");
  const colonial = makeFilter("Colonial", "#4f6f6a");
  const modern = makeFilter("Modern", "#3c4a6b");
  const monuments = makeFilter("Monuments", "#b4532a");
  const markets = makeFilter("Markets", "#8c6d3f");
  const worship = makeFilter("Places of worship", "#4f6f6a");
  const textiles = makeFilter("Textiles");
  const coins = makeFilter("Coins");
  const tools = makeFilter("Everyday life");

  s.apps = [
    {
      id: storyId(),
      kind: "timeline",
      title: "Through the ages",
      tagline: "From settlement to metropolis",
      coverUrl: IMG.interior,
      filters: [ancient, medieval, colonial, modern],
      events: [
        ev(300, ancient, "First settlement", "A village on the river bend", "Archaeologists have found pottery and post-holes dating to around this time.", { dateLabel: "c. 300 CE" }),
        ev(850, ancient, "A trading post", "Where the routes crossed", "Merchants from three regions met here to trade salt, spice and cloth.", { dateLabel: "c. 850" }),
        ev(1190, medieval, "The fort is built", "Walls of stone", "The first ruler of the city raised the fort that still stands on the hill."),
        ev(1420, medieval, "The great market", "A city of trade", "The covered market opened — at the time, the largest in the region."),
        ev(1610, colonial, "New arrivals", "A port city", "Ships brought new goods, new faiths and new architecture."),
        ev(1857, colonial, "The railway", "Connected to the world", "The station opened, and the city doubled in size within twenty years."),
        ev(1947, modern, "A new chapter", "Independence", "Celebrations filled the old market square."),
        ev(2010, modern, "Heritage city", "Protected for the future", "The old quarter was declared a protected heritage zone."),
      ],
    },
    {
      id: storyId(),
      kind: "map",
      title: "Landmarks",
      tagline: "Find the city's historic places",
      coverUrl: null,
      mapUrl: null,
      mode: "pins",
      dial: true,
      regions: [],
      filters: [monuments, markets, worship],
      pins: [
        pin(50, 22, monuments, "The hill fort", "Monuments · 1190", "The oldest standing structure in the city."),
        pin(44, 50, markets, "The covered market", "Markets · 1420", "Still trading, six hundred years on."),
        pin(62, 46, worship, "The old temple", "Worship · c. 1200", "Rebuilt three times on the same foundations."),
        pin(30, 64, monuments, "Clock tower", "Monuments · 1885", "Built to keep the railway's time."),
        pin(72, 70, worship, "The harbour mosque", "Worship · 1640", "Built by merchants from across the sea."),
        pin(58, 80, markets, "Spice street", "Markets · 1600s", "Follow your nose."),
      ],
    },
    {
      id: storyId(),
      kind: "map",
      title: "The old quarters",
      tagline: "Tap a neighbourhood to hear its story",
      coverUrl: null,
      mapUrl: null,
      mode: "regions",
      dial: true,
      pins: [],
      filters: [ancient, medieval, colonial, modern],
      regions: [
        region([[38, 14], [62, 12], [66, 34], [44, 38], [34, 28]], ancient, "Fort hill", "The oldest quarter", "Where the first settlers built, above the flood line."),
        region([[30, 40], [48, 38], [52, 58], [34, 62], [26, 52]], medieval, "Market quarter", "Trade since 1420", "Narrow lanes laid out around the covered market — each one named after the goods once sold there."),
        region([[54, 40], [76, 36], [82, 56], [58, 60]], colonial, "Harbour district", "The port city", "Warehouses, merchants' houses and the harbour mosque, built as the port grew."),
        region([[20, 66], [52, 64], [56, 86], [24, 88]], modern, "Railway town", "After 1857", "The new town that grew up around the station, with the clock tower at its heart."),
      ],
    },
    {
      id: storyId(),
      kind: "showcase",
      title: "Artefacts",
      tagline: "Objects from the collection",
      coverUrl: null,
      filters: [textiles, coins, tools],
      items: [
        item(textiles, "Block-printed cloth", "Textiles · 17th century", "Hand-printed with carved wooden blocks, traded across the ocean."),
        item(textiles, "Wedding shawl", "Textiles · 19th century", "Woven over two years by a single family."),
        item(coins, "Silver coin", "Coins · 12th century", "Minted in the city during the reign of its first ruler."),
        item(coins, "Trade token", "Coins · 18th century", "Used in the market instead of small change."),
        item(tools, "Clay oil lamp", "Everyday life · c. 300", "Found in the earliest layers of the settlement."),
        item(tools, "Merchant's scales", "Everyday life · 15th century", "Brass scales from the covered market."),
      ],
    },
    {
      id: storyId(),
      kind: "hotspots",
      title: "Reading the fort",
      tagline: "Tap to explore its architecture",
      coverUrl: IMG.centre,
      imageUrl: IMG.centre,
      hotspots: [
        spot(22, 30, "The watchtower", "1190", "From the top, guards could see a day's ride in every direction."),
        spot(50, 62, "The main gate", "Rebuilt 1520", "Iron spikes on the doors kept war elephants out."),
        spot(78, 44, "The step-well", "1230", "Water for a thousand people through a three-month siege."),
      ],
    },
  ];
  return s;
}

/** School or university history: collegiate green and cream, a campus map. */
function institution(W: number, H: number): StoryContent {
  const s = base(W, H, {
    background: "#0f2a22",
    surface: "#173a2f",
    text: "#f4efe2",
    muted: "#a9bdb2",
    accent: "#d9b45a",
    accentText: "#0f2a22",
    headingFont: F["Gelasio"],
    bodyFont: F["Inter"],
    radius: 12,
  });
  s.idle.prompt = "Touch to explore our history";
  s.idle.slides = [
    slide("Founded 1921", "A century of learning.", IMG.interior),
    slide("Generations of students", "Over 80,000 graduates and counting.", IMG.centre),
    slide("Our story", "Touch the screen to explore."),
  ];
  s.home = { headline: "A Century of Learning", subheadline: "1921 – today", backgroundUrl: null };

  const founding = makeFilter("Founding years", "#d9b45a");
  const growth = makeFilter("Growth", "#8fc1a9");
  const modern = makeFilter("Modern era", "#9fb4e0");
  const halls = makeFilter("Halls", "#d9b45a");
  const labs = makeFilter("Labs & libraries", "#8fc1a9");
  const sport = makeFilter("Sport", "#e08f7a");
  const science = makeFilter("Science");
  const arts = makeFilter("Arts");
  const publicLife = makeFilter("Public life");

  s.apps = [
    {
      id: storyId(),
      kind: "timeline",
      title: "Our history",
      tagline: "A hundred years, decade by decade",
      coverUrl: IMG.interior,
      filters: [founding, growth, modern],
      events: [
        ev(1921, founding, "Founded", "Forty students, six teachers", "Classes began in a single house donated by the town's first doctor."),
        ev(1932, founding, "The main hall", "Our first building", "Built by public subscription — every family in the town gave something."),
        ev(1948, growth, "Opening the doors", "Scholarships for all", "The first scholarship fund, open to any student who passed the entrance exam."),
        ev(1961, growth, "The science block", "Labs for a new age", "Four laboratories and the region's first observatory."),
        ev(1975, growth, "University status", "A new name", "Recognised as a university, with its first postgraduate degrees."),
        ev(1998, modern, "Going digital", "The new library", "A library with more computers than books — for a while.", { image: IMG.centre }),
        ev(2012, modern, "Research centre", "Science at scale", "A centre for research that now hosts six hundred scientists."),
        ev(2021, modern, "Centenary", "One hundred years", "Eighty thousand graduates came home to celebrate.", { dateLabel: "2021" }),
      ],
    },
    {
      id: storyId(),
      kind: "map",
      title: "The campus",
      tagline: "Tap a building to see how it began",
      coverUrl: null,
      mapUrl: null,
      mode: "regions",
      dial: true,
      pins: [],
      filters: [halls, labs, sport],
      regions: [
        region([[24, 30], [40, 30], [40, 48], [24, 48]], halls, "Founders' House", "Halls · 1921", "The original house where it all began, now the admissions office."),
        region([[44, 18], [60, 18], [60, 40], [44, 40]], halls, "Main Hall", "Halls · 1932", "Where every graduation has been held for ninety years."),
        region([[62, 38], [80, 38], [80, 58], [62, 58]], labs, "Science block", "Labs · 1961", "Home to the observatory dome."),
        region([[34, 54], [56, 54], [56, 72], [34, 72]], labs, "The library", "Libraries · 1998", "Two million volumes and the original 1921 register."),
        region([[62, 64], [90, 62], [92, 88], [64, 90]], sport, "The playing fields", "Sport · 1935", "Laid out by students on weekends."),
      ],
    },
    {
      id: storyId(),
      kind: "showcase",
      title: "Notable alumni",
      tagline: "Where our graduates went",
      coverUrl: null,
      filters: [science, arts, publicLife],
      items: [
        item(science, "Alumna name", "Class of 1964 · Physics", "Led the team that built the country's first research satellite."),
        item(science, "Alumnus name", "Class of 1988 · Medicine", "Pioneered a treatment now used in hospitals worldwide."),
        item(arts, "Alumna name", "Class of 1972 · Literature", "Award-winning novelist and translator."),
        item(arts, "Alumnus name", "Class of 2005 · Architecture", "Designed the new library extension."),
        item(publicLife, "Alumna name", "Class of 1959 · Law", "The first woman to serve on the high court."),
        item(publicLife, "Alumnus name", "Class of 1991 · Economics", "Former finance minister."),
      ],
    },
  ];
  return s;
}

/** Brand and product evolution: clean white, black type, one bold red accent. */
function brandEvolution(W: number, H: number): StoryContent {
  const s = base(W, H, {
    background: "#f6f6f4",
    surface: "#ffffff",
    text: "#111111",
    muted: "#6b6b6b",
    accent: "#e1251b",
    accentText: "#ffffff",
    headingFont: F["Archivo Expanded"],
    bodyFont: F["Inter"],
    radius: 24,
  });
  s.idle.prompt = "Touch to see how we got here";
  s.idle.slides = [
    slide("Designed to last", "Every product we've made, and why.", IMG.brand),
    slide("From the first sketch", "To the product in your hand.", IMG.centre),
    slide("Explore the archive", "Touch to begin."),
  ];
  s.home = { headline: "The Archive", subheadline: "How our products and brand evolved", backgroundUrl: null };

  const product = makeFilter("Product", "#e1251b");
  const design = makeFilter("Design", "#111111");
  const tech = makeFilter("Technology", "#2f6fec");
  const icons = makeFilter("Icons");
  const logos = makeFilter("Identity");
  const campaigns = makeFilter("Campaigns");

  s.apps = [
    {
      id: storyId(),
      kind: "timeline",
      title: "Product milestones",
      tagline: "Every launch that mattered",
      coverUrl: IMG.brand,
      filters: [product, design, tech],
      events: [
        ev(1986, product, "Model One", "Where it started", "Our first product, assembled by hand, sold out in a week."),
        ev(1991, design, "The first logo", "A mark is born", "Drawn on a napkin by our first designer. Still recognisable today."),
        ev(1997, tech, "Going electronic", "The first smart model", "A chip inside changed what the product could do."),
        ev(2004, product, "The icon", "Model Five", "The design that became the one everyone remembers.", { image: IMG.brand }),
        ev(2010, design, "A new identity", "Simpler, bolder", "A refreshed identity across every product and store."),
        ev(2016, tech, "Connected", "The app arrives", "Every product, controllable from your phone."),
        ev(2022, product, "Circular", "Made to be remade", "The first product designed to be fully recycled.", { image: IMG.centre }),
        ev(2025, design, "Next", "What comes after", "A preview of the products we're working on now.", { dateLabel: "Now" }),
      ],
    },
    {
      id: storyId(),
      kind: "showcase",
      title: "Icons",
      tagline: "Products, logos and campaigns",
      coverUrl: null,
      filters: [icons, logos, campaigns],
      items: [
        item(icons, "Model One", "1986", "The product that started it all.", IMG.brand),
        item(icons, "Model Five", "2004", "Our best-selling product of all time."),
        item(icons, "Circular", "2022", "Designed to be taken apart."),
        item(logos, "The napkin logo", "1991", "Our first identity."),
        item(logos, "The refresh", "2010", "Simpler, bolder, everywhere."),
        item(campaigns, "“Built to last”", "1999", "Our first national campaign."),
        item(campaigns, "“Made again”", "2022", "Launching our circular range."),
      ],
    },
    {
      id: storyId(),
      kind: "hotspots",
      title: "Anatomy of an icon",
      tagline: "What makes Model Five work",
      coverUrl: IMG.brand,
      imageUrl: IMG.brand,
      hotspots: [
        spot(30, 40, "The curve", "Design", "Hand-modelled in clay, refined over forty prototypes."),
        spot(58, 56, "The dial", "Interaction", "One control does everything — the idea we've kept ever since."),
        spot(76, 30, "The finish", "Material", "Anodised aluminium, the same process for twenty years."),
      ],
    },
  ];
  return s;
}

export const STORY_PRESETS: StoryPreset[] = [
  { id: "heritage", label: "Company heritage", description: "Archival cream and serif type: decades, founders, sites, the workshop", defaultName: "Our heritage", build: heritage },
  { id: "anniversary", label: "Anniversary", description: "Midnight and gold for a milestone year: moments, firsts, offices", defaultName: "25 years", build: anniversary },
  { id: "legacy", label: "Founder's legacy", description: "Black and white, editorial: life chapters, quotes, objects", defaultName: "A legacy", build: legacy },
  { id: "city", label: "City & museum", description: "Parchment and terracotta: eras, landmarks map, artefacts", defaultName: "Stories of the city", build: cityHeritage },
  { id: "institution", label: "School & university", description: "Collegiate green: a century, campus map, notable alumni", defaultName: "A century of learning", build: institution },
  { id: "brand", label: "Brand archive", description: "Clean white with a red accent: launches, icons, product anatomy", defaultName: "The archive", build: brandEvolution },
  { id: "sample", label: "Sample story", description: "Every module type, filled with placeholder content to replace", defaultName: "Our story", build: sampleStory },
  { id: "blank", label: "Blank story", description: "An empty menu — add modules yourself", defaultName: "Untitled story", build: blankStory },
];

// ─── Composing a new story: modules first, then the look ─────────────────────

/** Every module kind, in the order they're offered. */
export const STORY_MODULE_KINDS: StoryAppKind[] = ["timeline", "map", "showcase", "hotspots", "video"];

/** Base palettes for a story in the operator's own brand (also the editor's theme row). */
export const STORY_PALETTES: { label: string; brand: Partial<StoryBrand> }[] = [
  { label: "Night", brand: { background: "#0b0d12", surface: "#161a22", text: "#f5f6f8", muted: "#9aa3b2", accent: "#92ff5f", accentText: "#0b0d12" } },
  { label: "Paper", brand: { background: "#f4f1ea", surface: "#ffffff", text: "#1a1a1a", muted: "#6b6b6b", accent: "#1a1a1a", accentText: "#ffffff" } },
  { label: "Ocean", brand: { background: "#06172b", surface: "#0e2744", text: "#eaf4ff", muted: "#8fb0d0", accent: "#38bdf8", accentText: "#06172b" } },
  { label: "Ember", brand: { background: "#1c1210", surface: "#2a1c18", text: "#fff4ee", muted: "#c9a99a", accent: "#ff7a45", accentText: "#1c1210" } },
];

/** The ready-made looks. Sample and Blank are what "Your brand" builds on. */
export const STORY_THEMES: StoryPreset[] = STORY_PRESETS.filter((p) => p.id !== "sample" && p.id !== "blank");

export type StoryLook = { kind: "brand"; brand: Partial<StoryBrand> } | { kind: "theme"; themeId: string };

/**
 * A new story with exactly the chosen modules, in the chosen look. A theme
 * keeps its own modules of those kinds (in its own order) and borrows the
 * sample's for any kind it doesn't have. Without examples, every module
 * starts empty.
 */
export function composeStory(opts: {
  modules: StoryAppKind[];
  look: StoryLook;
  examples: boolean;
  width: number;
  height: number;
}): { content: StoryContent; defaultName: string } {
  const { modules, look, examples, width: W, height: H } = opts;
  const picked = STORY_MODULE_KINDS.filter((k) => modules.includes(k));
  const theme = look.kind === "theme" ? (STORY_THEMES.find((t) => t.id === look.themeId) ?? STORY_THEMES[0]!) : null;
  const sample = sampleStory(W, H);
  const s = theme ? theme.build(W, H) : examples ? sample : blankStory(W, H);
  if (look.kind === "brand") s.brand = { ...s.brand, ...look.brand };

  if (!examples) {
    s.apps = picked.map(makeApp);
  } else {
    const kept = s.apps.filter((a) => picked.includes(a.kind));
    const borrowed = picked.filter((k) => !kept.some((a) => a.kind === k)).flatMap((k) => sample.apps.filter((a) => a.kind === k));
    s.apps = [...kept, ...borrowed];
  }
  return { content: s, defaultName: theme?.defaultName ?? "Our story" };
}
