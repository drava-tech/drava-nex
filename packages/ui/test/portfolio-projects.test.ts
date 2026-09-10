import { describe, it, expect } from "vitest";
import {
  normalizeSections,
  companyLinks,
  projectSlugs,
  sectionCoverImage,
  type OverviewCard,
  type PortfolioSection,
} from "../src/templates/portfolio/content";

// A category holds one page per company, and the company name is the only thing
// tying a client's pages together across categories — so what's checked here is
// the migration (rows saved before companies existed must keep rendering) and
// the matching that draws the jump buttons.

const section = (s: Partial<PortfolioSection> & { name: string }): PortfolioSection => ({
  images: [],
  ...s,
});

const card = (title: string, sections: PortfolioSection[]): OverviewCard => ({
  title,
  imageUrl: "",
  button1: "Watch Video",
  button2: "Projects",
  sections,
});

/** Two verticals, four categories, Collins in three of them. */
const cards = (): OverviewCard[] => [
  card("Experience Centre", [
    section({
      name: "Spatial Design and Build",
      type: "gallery",
      projects: [
        { company: "Collins Aerospace", title: "Concourse", images: ["/a.png"] },
        { company: "Boeing", images: ["/b.png"] },
      ],
    }),
    section({
      name: "Experience Technology",
      type: "gallery",
      projects: [{ company: "collins  aerospace", images: ["/c.png"] }],
    }),
  ]),
  card("Brand Experience", [
    section({
      name: "Brand Films",
      type: "gallery",
      projects: [{ company: "COLLINS AEROSPACE", images: ["/d.png"] }],
    }),
    // A slideshow category, deliberately: it can't be a jump target.
    section({ name: "Brand Experiences", type: "images", images: ["/e.png"] }),
  ]),
];

describe("normalizeSections — project migration", () => {
  it("folds a pre-companies gallery into one unnamed project", () => {
    const [s] = normalizeSections([
      section({
        name: "Brand Films",
        type: "gallery",
        title: "3D Narratives",
        subtitle: "Corporate Films",
        description: "Storytelling through sculpted forms.",
        images: ["/1.png", "/2.png"],
      }),
    ]);

    expect(s!.projects).toEqual([
      {
        company: "",
        title: "3D Narratives",
        subtitle: "Corporate Films",
        description: "Storytelling through sculpted forms.",
        images: ["/1.png", "/2.png"],
        videos: [],
      },
    ]);
  });

  it("leaves the section's own fields in place, so switching type back is lossless", () => {
    const [s] = normalizeSections([
      section({ name: "Workspace", type: "gallery", title: "T", images: ["/1.png"] }),
    ]);
    expect(s!.title).toBe("T");
    expect(s!.images).toEqual(["/1.png"]);
  });

  it("always yields at least one project, even for an empty category", () => {
    for (const s of normalizeSections(undefined)) {
      expect(s.projects).toHaveLength(1);
    }
  });

  it("drops non-string image entries from a stored project", () => {
    const [s] = normalizeSections([
      section({
        name: "Brand Films",
        type: "gallery",
        projects: [{ company: "X", images: ["/1.png", null, 7, ""] as unknown as string[] }],
      }),
    ]);
    expect(s!.projects![0]!.images).toEqual(["/1.png"]);
  });
});

describe("normalizeProjects — the film", () => {
  const projectsOf = (projects: unknown) =>
    normalizeSections([
      section({ name: "Brand Films", type: "gallery", projects: projects as never }),
    ])[0]!.projects!;

  it("keeps films that were set or migrates legacy videoUrl", () => {
    expect(projectsOf([{ company: "Acme", images: [], videoUrl: "/film.mp4" }])[0]!.videos).toEqual([
      "/film.mp4",
    ]);
  });

  it("drops a blank one rather than storing an empty string", () => {
    expect(projectsOf([{ company: "Acme", images: [], videoUrl: "" }])[0]!.videos).toEqual([]);
  });

  it("drops a non-string one", () => {
    expect(projectsOf([{ company: "Acme", images: [], videoUrl: 42 }])[0]!.videos).toEqual([]);
  });

  it("gives a migrated pre-companies gallery no films", () => {
    const [s] = normalizeSections([
      section({ name: "Brand Films", type: "gallery", title: "T", images: ["/1.png"] }),
    ]);
    expect(s!.projects![0]!.videos).toEqual([]);
  });
});

describe("companyLinks", () => {
  it("finds the same company in every other gallery category", () => {
    const links = companyLinks(cards(), { cardIndex: 0, sectionIndex: 0, projectIndex: 0 });

    // Card order then section order, so the row doesn't reshuffle between pages.
    expect(links).toEqual([
      { label: "Experience Technology", cardIndex: 0, sectionIndex: 1, projectIndex: 0 },
      { label: "Brand Films", cardIndex: 1, sectionIndex: 0, projectIndex: 0 },
    ]);
  });

  it("matches on the slugified name, so casing and spacing needn't agree", () => {
    // "Collins Aerospace" / "collins  aerospace" / "COLLINS AEROSPACE" above.
    expect(companyLinks(cards(), { cardIndex: 1, sectionIndex: 0, projectIndex: 0 })).toHaveLength(2);
  });

  it("never links a page to itself", () => {
    const links = companyLinks(cards(), { cardIndex: 0, sectionIndex: 1, projectIndex: 0 });
    expect(links.some((l) => l.cardIndex === 0 && l.sectionIndex === 1)).toBe(false);
  });

  it("returns nothing for a company that appears only once", () => {
    // Boeing — card 0, section 0, second project.
    expect(companyLinks(cards(), { cardIndex: 0, sectionIndex: 0, projectIndex: 1 })).toEqual([]);
  });

  it("returns nothing for an untagged project, rather than matching every other blank", () => {
    const untagged = [
      card("A", [
        section({ name: "One", type: "gallery", projects: [{ company: "", images: [] }] }),
        section({ name: "Two", type: "gallery", projects: [{ company: "", images: [] }] }),
      ]),
    ];
    expect(companyLinks(untagged, { cardIndex: 0, sectionIndex: 0, projectIndex: 0 })).toEqual([]);
  });

  it("works from every one of the six leaf categories, not just the first", () => {
    // Nothing about the linking is tied to a particular vertical or to the
    // first of a vertical's two categories — same company in all six slots,
    // and each page should see the other five.
    const everywhere = ["Experience Centre", "Interior Spaces", "Brand Experience"].map((title, ci) =>
      card(title, [
        section({
          name: `Category ${ci * 2 + 1}`,
          type: "gallery",
          projects: [{ company: "Acme", images: [] }],
        }),
        section({
          name: `Category ${ci * 2 + 2}`,
          type: "gallery",
          projects: [{ company: "Acme", images: [] }],
        }),
      ])
    );

    for (let cardIndex = 0; cardIndex < 3; cardIndex++) {
      for (let sectionIndex = 0; sectionIndex < 2; sectionIndex++) {
        const links = companyLinks(everywhere, { cardIndex, sectionIndex, projectIndex: 0 });
        expect(links, `from card ${cardIndex}, section ${sectionIndex}`).toHaveLength(5);
      }
    }
  });

  it("skips categories that aren't galleries", () => {
    const withSlideshow = [
      card("A", [
        section({ name: "Gallery one", type: "gallery", projects: [{ company: "X", images: [] }] }),
        section({
          name: "Slideshow",
          type: "images",
          images: [],
          projects: [{ company: "X", images: [] }],
        }),
      ]),
    ];
    expect(companyLinks(withSlideshow, { cardIndex: 0, sectionIndex: 0, projectIndex: 0 })).toEqual([]);
  });
});

describe("projectSlugs", () => {
  it("uses the company name", () => {
    expect(projectSlugs([{ company: "Collins Aerospace", images: [] }])).toEqual([
      "collins-aerospace",
    ]);
  });

  it("falls back to the title, then to a positional slug", () => {
    expect(
      projectSlugs([
        { company: "", title: "Concourse", images: [] },
        { company: "", images: [] },
      ])
    ).toEqual(["concourse", "project-2"]);
  });

  it("keeps duplicates distinct so one URL can't shadow another", () => {
    const slugs = projectSlugs([
      { company: "Acme", images: [] },
      { company: "acme", images: [] },
    ]);
    expect(new Set(slugs).size).toBe(2);
  });
});

describe("sectionCoverImage", () => {
  it("takes a gallery's cover from its first project with a photo", () => {
    const [s] = normalizeSections([
      section({
        name: "Brand Films",
        type: "gallery",
        images: [],
        projects: [
          { company: "Empty", images: [] },
          { company: "Collins", images: ["/d.png"] },
        ],
      }),
    ]);
    // Without this the split-view panel is blank for any category authored
    // purely through companies, since nothing writes the section's own images.
    expect(sectionCoverImage(s!)).toBe("/d.png");
  });

  it("still uses the section's own images for a slideshow", () => {
    const [s] = normalizeSections([section({ name: "Workspace", type: "images", images: ["/e.png"] })]);
    expect(sectionCoverImage(s!)).toBe("/e.png");
  });
});
