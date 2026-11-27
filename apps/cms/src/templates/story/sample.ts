import {
  blankStory,
  makeFilter,
  storyId,
  type StoryContent,
  type StoryMedia,
} from "@platform/ui/templates/story";

/**
 * A filled-in starter story — every app type with placeholder copy, so an
 * operator sees the whole experience working and replaces text and images
 * rather than starting from nothing. Images are neutral stock photos.
 */
const IMG = {
  centre: "/media/stock/city-street.jpg",
  brand: "/media/stock/flatlay.jpg",
  interior: "/media/stock/cafe-tables.jpg",
};

const img = (url: string): StoryMedia => ({ id: storyId(), type: "image", url });

export function sampleStory(width = 1920, height = 1080): StoryContent {
  const s = blankStory(width, height);

  s.idle.slides = [
    { id: storyId(), mediaUrl: IMG.centre, mediaType: "image", headline: "Welcome", body: "Twenty years of building things people remember." },
    { id: storyId(), mediaUrl: IMG.brand, mediaType: "image", headline: "Our story, in your hands", body: "Milestones, places and the work that made us." },
    { id: storyId(), mediaUrl: IMG.interior, mediaType: "image", headline: "Made by people", body: "Touch the screen to explore." },
  ];
  s.home = { headline: "Explore our story", subheadline: "Tap a tile to begin", backgroundUrl: null };

  const early = makeFilter("Beginnings", "#f59e0b");
  const growth = makeFilter("Growth", "#38bdf8");
  const today = makeFilter("Today", "#92ff5f");
  const offices = makeFilter("Offices", "#92ff5f");
  const partners = makeFilter("Partners", "#38bdf8");
  const projects = makeFilter("Projects", "#f472b6");
  const spaces = makeFilter("Spaces");
  const brands = makeFilter("Brands");
  const tech = makeFilter("Technology");

  s.apps = [
    {
      id: storyId(),
      kind: "timeline",
      title: "Our journey",
      tagline: "The milestones that shaped us",
      coverUrl: IMG.centre,
      filters: [early, growth, today],
      events: [
        { id: storyId(), year: 2004, dateLabel: "", filterId: early.id, title: "Founded", subtitle: "A two-person studio", body: "We started with one client, one room and a big idea about how spaces should feel.", media: [] },
        { id: storyId(), year: 2008, dateLabel: "", filterId: early.id, title: "First flagship project", subtitle: "A landmark retail space", body: "Our first large-scale build put us on the map.", media: [img(IMG.interior)] },
        { id: storyId(), year: 2013, dateLabel: "", filterId: growth.id, title: "Second city", subtitle: "Opening a new office", body: "Growing demand took us to a second city and a team of forty.", media: [] },
        { id: storyId(), year: 2017, dateLabel: "", filterId: growth.id, title: "Brand experiences", subtitle: "A new practice", body: "We began designing complete brand experiences — physical and digital together.", media: [img(IMG.brand)] },
        { id: storyId(), year: 2021, dateLabel: "", filterId: today.id, title: "Experience Centre", subtitle: "Where you are now", body: "A space to show, not tell: every product we make, working.", media: [img(IMG.centre)] },
        { id: storyId(), year: 2025, dateLabel: "Today", filterId: today.id, title: "What's next", subtitle: "Smart, connected spaces", body: "Screens, sensors and content that respond to the people in the room.", media: [] },
      ],
    },
    {
      id: storyId(),
      kind: "map",
      title: "Where we work",
      tagline: "Offices, partners and projects",
      coverUrl: null,
      mapUrl: null,
      mode: "pins",
      dial: true,
      regions: [],
      filters: [offices, partners, projects],
      pins: [
        { id: storyId(), x: 22, y: 38, filterId: offices.id, title: "Head office", subtitle: "Offices", body: "Where it all started. Design, engineering and our largest studio.", media: [] },
        { id: storyId(), x: 48, y: 30, filterId: partners.id, title: "Technology partner", subtitle: "Partners", body: "Display and sensor hardware partner since 2016.", media: [] },
        { id: storyId(), x: 63, y: 55, filterId: projects.id, title: "Airport lounge", subtitle: "Projects", body: "A calm, connected lounge for 400 travellers a day.", media: [img(IMG.interior)] },
        { id: storyId(), x: 78, y: 42, filterId: offices.id, title: "Regional office", subtitle: "Offices", body: "Our newest team, serving clients across the region.", media: [] },
        { id: storyId(), x: 36, y: 68, filterId: projects.id, title: "Flagship store", subtitle: "Projects", body: "A brand experience across three floors.", media: [img(IMG.brand)] },
      ],
    },
    {
      id: storyId(),
      kind: "showcase",
      title: "Our work",
      tagline: "Projects, products and people",
      coverUrl: IMG.brand,
      filters: [spaces, brands, tech],
      items: [
        { id: storyId(), filterId: spaces.id, coverUrl: IMG.interior, title: "Workplace of the future", subtitle: "Spaces", body: "Flexible floors that reconfigure in minutes.", media: [img(IMG.interior)] },
        { id: storyId(), filterId: brands.id, coverUrl: IMG.brand, title: "Brand launch", subtitle: "Brands", body: "A launch event built around one hero product.", media: [img(IMG.brand)] },
        { id: storyId(), filterId: tech.id, coverUrl: IMG.centre, title: "Experience Centre", subtitle: "Technology", body: "Every screen in this room is driven by our own CMS.", media: [img(IMG.centre)] },
        { id: storyId(), filterId: spaces.id, coverUrl: null, title: "Hospitality suite", subtitle: "Spaces", body: "Warm materials and quiet technology.", media: [] },
        { id: storyId(), filterId: tech.id, coverUrl: null, title: "Interactive walls", subtitle: "Technology", body: "Touch and gesture-driven content at architectural scale.", media: [] },
        { id: storyId(), filterId: brands.id, coverUrl: null, title: "Retail roll-out", subtitle: "Brands", body: "One design system across 120 stores.", media: [] },
      ],
    },
    {
      id: storyId(),
      kind: "hotspots",
      title: "Inside the space",
      tagline: "Tap the points to learn more",
      coverUrl: IMG.interior,
      imageUrl: IMG.interior,
      hotspots: [
        { id: storyId(), x: 30, y: 40, title: "Adaptive lighting", subtitle: "Comfort", body: "Lighting follows daylight and the time of day.", media: [] },
        { id: storyId(), x: 58, y: 55, title: "Acoustic design", subtitle: "Comfort", body: "Materials chosen to keep conversations private.", media: [] },
        { id: storyId(), x: 76, y: 32, title: "Connected screens", subtitle: "Technology", body: "Every display can be updated from one place.", media: [] },
      ],
    },
    {
      id: storyId(),
      kind: "video",
      title: "Our story, told by us",
      tagline: "Short films and narrated photos",
      coverUrl: IMG.centre,
      autoAdvance: true,
      chapters: [
        { id: storyId(), title: "Where it began", subtitle: "Chapter one", body: "Add a voice-over to a photo and it becomes a narrated chapter — this text shows as captions while it plays.", media: [], videoUrl: null, posterUrl: IMG.interior, voiceUrl: null },
        { id: storyId(), title: "Building the centre", subtitle: "Chapter two", body: "Or add a video. With a voice-over too, the video plays muted under the narration.", media: [], videoUrl: null, posterUrl: IMG.centre, voiceUrl: null },
        { id: storyId(), title: "What's next", subtitle: "Chapter three", body: "Chapters play one after another, and the wall stays awake until they finish.", media: [], videoUrl: null, posterUrl: IMG.brand, voiceUrl: null },
      ],
    },
  ];
  return s;
}
