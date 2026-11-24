import type { CanvasPage } from "@platform/ui/templates/canvas";
import { LAYOUTS, type Copy, type LayoutId } from "./layouts";
import { pics } from "./stock";
import { CANVAS_THEMES, type CanvasThemeId } from "./themes";

/**
 * The Design template library: every entry is a layout, a theme and copy
 * written for the screens Nex drives — lobbies, experience centres, events,
 * retail, hospitality, campuses and offices. Each builds for any canvas size.
 */

export const TEMPLATE_CATEGORIES = [
  { id: "welcome", label: "Welcome & lobby" },
  { id: "experience", label: "Experience centre" },
  { id: "events", label: "Events" },
  { id: "schedule", label: "Agendas & schedules" },
  { id: "announce", label: "Announcements" },
  { id: "corporate", label: "Corporate & KPIs" },
  { id: "people", label: "People & culture" },
  { id: "retail", label: "Retail & offers" },
  { id: "food", label: "Food & hospitality" },
  { id: "wayfinding", label: "Wayfinding & info" },
  { id: "safety", label: "Safety & notices" },
  { id: "launch", label: "Launches & countdowns" },
  { id: "celebrate", label: "Celebrations" },
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]["id"];

export interface CanvasTemplate {
  id: string;
  label: string;
  category: TemplateCategory;
  layout: LayoutId;
  theme: CanvasThemeId;
  build: (width: number, height: number) => CanvasPage;
}


const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Entry = [label: string, layout: LayoutId, theme: CanvasThemeId, copy: Copy];

const LIB: Record<TemplateCategory, Entry[]> = {
  welcome: [
    ["Guest welcome", "photoCenter", "nex", { eyebrow: "Welcome", title: "Guest Name", body: "We're delighted to have you with us today.", footer: "Hosted by the Experience team", images: pics("balcony") }],
    ["VIP arrival", "frame", "gold", { eyebrow: "A warm welcome to", title: "Ms. Ananya Rao\n& Delegation", body: "Chief Executive, Northwind Holdings", footer: "Monday · 18 November" }],
    ["Lobby hello", "hero", "nex", { eyebrow: "Good morning", title: "Welcome to\nthe Experience Centre", body: "Check in at reception and we'll take it from here.", brand: "Your logo" }],
    ["Client visit", "split", "mono", { eyebrow: "Today we're hosting", title: "Northwind\nHoldings", body: "Thank you for making the journey. Your tour begins at 10:30 in the Gallery.", cta: "Gallery · Level 2", images: pics("coworking") }],
    ["Delegation welcome", "editorial", "ivory", { eyebrow: "Welcome", title: "The Ministry of\nUrban Development", body: "A morning of ideas, demonstrations and conversation.", brand: "Your logo", footer: "Boardroom · 10:00 – 13:00" }],
    ["Reception check-in", "nowNext", "clinic", { eyebrow: "Visitors", title: "Please check in\nat reception", body: "Have your ID ready — we'll print your pass in seconds.", items: [{ label: "Wi-Fi", note: "Guest · password on your pass", value: "Free" }], brand: "Your logo" }],
    ["Brand welcome", "photo", "violet", { eyebrow: "You've arrived", title: "Where ideas\nbecome experiences", body: "Step inside and see what we build.", images: pics("cityNight"), brand: "Your logo" }],
    ["Hotel welcome", "frame", "sand", { eyebrow: "Welcome to", title: "The Garden Suite", body: "Your host will be with you shortly. Help yourself to refreshments.", footer: "Concierge · dial 0" }],
    ["Campus welcome", "hero", "forest", { eyebrow: "Welcome to campus", title: "Open Day 2026", body: "Tours leave from the main quad every 30 minutes.", footer: "Admissions · Main Hall" }],
    ["Interview day", "editorial", "slate", { eyebrow: "Welcome", title: "Interview candidates", body: "Take a seat — someone from People Ops will collect you.", footer: "Level 3 · Meeting room Cedar" }],
  ],
  experience: [
    ["Showcase hero", "photo", "nex", { eyebrow: "Experience centre", title: "See the future\nof the workplace", body: "Twelve live demonstrations, one walk-through.", images: pics("workspace"), brand: "Your logo" }],
    ["Zone intro", "split", "ocean", { eyebrow: "Zone 03", title: "Immersive\nretail", body: "Touch, scan and try on — how stores sell when every surface is a screen.", cta: "Start here", images: pics("flatlay") }],
    ["Capability cards", "cards", "nex", { eyebrow: "What we do", title: "Three ways we build", items: [{ value: "01", label: "Spaces", note: "Experience centres and flagship stores" }, { value: "02", label: "Screens", note: "Video walls, LED and interactive tables" }, { value: "03", label: "Stories", note: "Content made for the space" }], images: pics("deskTop", "studioDesk", "camera") }],
    ["Project gallery", "mosaic", "mono", { eyebrow: "Selected work", title: "Spaces we've\nbrought to life", body: "Forty experience centres across nine countries.", images: pics("campus", "skyline", "cityStreet") }],
    ["By the numbers", "stats", "nex", { eyebrow: "Since 2006", title: "Twenty years of building", items: [{ value: "240+", label: "Experiences delivered" }, { value: "9", label: "Countries" }, { value: "1.2M", label: "Visitors a year" }] }],
    ["Tech spotlight", "split", "violet", { eyebrow: "Live demo", title: "The touch\ntable", body: "Place an object on the surface and watch its story unfold.", cta: "Try it", images: pics("studioDesk") }],
    ["Tour route", "agenda", "ocean", { eyebrow: "Your tour", title: "Forty minutes, five stops", items: [{ value: "Stop 1", label: "The welcome wall", note: "Who we are, in ninety seconds" }, { value: "Stop 2", label: "Immersive retail", note: "Try the smart mirror" }, { value: "Stop 3", label: "Command centre", note: "Data, live" }, { value: "Stop 4", label: "The studio", note: "Where content is made" }, { value: "Stop 5", label: "Lounge", note: "Coffee and questions" }] }],
    ["Brand story", "editorial", "red", { eyebrow: "Our story", title: "We design\nmoments people\nremember", body: "From the first sketch to the final pixel, every experience is made for the room it lives in.", brand: "Your logo" }],
    ["Client quote", "quote", "nex", { title: "The centre changed how our customers see us — before they've spoken to anyone.", eyebrow: "Head of Brand", body: "Global retail group" }],
    ["Case study", "bigStat", "ocean", { eyebrow: "Case study · Retail", value: "+38%", title: "Dwell time in\nthe flagship store", body: "After the interactive façade launched in March." }],
    ["Partner wall", "list", "slate", { eyebrow: "In partnership with", title: "Technology partners", items: [{ label: "Display systems", value: "Partner one" }, { label: "Interactive surfaces", value: "Partner two" }, { label: "Audio", value: "Partner three" }, { label: "Lighting control", value: "Partner four" }, { label: "Cloud & data", value: "Partner five" }] }],
  ],
  events: [
    ["Launch night", "event", "nex", { eyebrow: "You're invited", title: "Product Launch\nEvening", body: "Demos, drinks and a first look at what's next.", date: { month: "Mar", day: "24", weekday: "Thursday" }, items: [{ label: "6:00 PM", value: "Experience Centre, Level 2" }], cta: "RSVP at reception" }],
    ["Keynote", "photoCenter", "violet", { eyebrow: "Keynote · Main stage", title: "Designing for\nthe next decade", body: "Priya Menon, Chief Design Officer", footer: "Starts at 10:00", images: pics("concert") }],
    ["Workshop", "event", "ivory", { eyebrow: "Workshop", title: "Storytelling\nfor spaces", body: "A hands-on morning for designers and producers.", date: { month: "Apr", day: "09", weekday: "Wednesday" }, items: [{ label: "9:30 AM", value: "Studio B" }, { label: "Limited to 20 seats" }] }],
    ["Gala dinner", "frame", "gold", { eyebrow: "The annual", title: "Gala Dinner", body: "An evening in celebration of the year's work.", footer: "Saturday 14 December · 7:30 PM · Black tie" }],
    ["Panel session", "split", "slate", { eyebrow: "Panel · 2:00 PM", title: "The future of\nretail spaces", body: "Four leaders on how stores will look in 2030.", cta: "Hall A", images: pics("notes") }],
    ["Town hall", "hero", "clinic", { eyebrow: "All hands", title: "Quarterly\nTown Hall", body: "Results, roadmap and your questions — live and in person.", footer: "Friday · 4:00 PM · Atrium & online" }],
    ["Webinar", "event", "ocean", { eyebrow: "Live online", title: "Smart buildings,\nexplained", body: "Thirty minutes, one expert, your questions.", date: { month: "May", day: "02", weekday: "Friday" }, items: [{ label: "11:00 AM IST" }], cta: "Scan to join" }],
    ["Meetup", "editorial", "ember", { eyebrow: "Community meetup", title: "Creative\nTechnologists", body: "Lightning talks, demos and pizza. Everyone welcome.", footer: "Every second Thursday · 6:30 PM", brand: "Your logo" }],
    ["Exhibition", "photo", "sand", { eyebrow: "Now showing", title: "Light & Space", body: "An exhibition of immersive installations. Until 30 June.", images: pics("lightShaft") }],
    ["Speaker", "profile", "nex", { eyebrow: "Next speaker", title: "Dr. Kavya Iyer", value: "Head of Research, Lumen Labs", body: "“The best interfaces disappear into the room.”", images: pics("photographer"), footer: "Main stage · 11:15" }],
    ["Awards night", "photoCenter", "gold", { eyebrow: "Tonight", title: "The Excellence\nAwards", body: "Celebrating the people behind the work.", footer: "Ballroom · 8:00 PM", images: pics("bokeh") }],
  ],
  schedule: [
    ["Conference day", "agenda", "nex", { eyebrow: "Day one", title: "Today's programme", items: [{ value: "09:00", label: "Registration & coffee", note: "Foyer" }, { value: "10:00", label: "Opening keynote", note: "Main stage" }, { value: "11:30", label: "Breakout sessions", note: "Rooms A – D" }, { value: "13:00", label: "Lunch", note: "Terrace" }, { value: "14:30", label: "Panel: Spaces that sell", note: "Main stage" }, { value: "16:00", label: "Closing remarks", note: "Main stage" }] }],
    ["Meeting rooms", "list", "slate", { eyebrow: "Today", title: "Meeting rooms", items: [{ label: "Cedar", note: "Design review", value: "10:00" }, { label: "Maple", note: "Client workshop", value: "11:30" }, { label: "Oak", note: "Board meeting", value: "14:00" }, { label: "Pine", note: "Available", value: "Free" }, { label: "Birch", note: "Interviews", value: "15:30" }, { label: "Ash", note: "Team stand-up", value: "17:00" }] }],
    ["Room now / next", "nowNext", "nex", { eyebrow: "Boardroom · Now", title: "Quarterly\nstrategy review", body: "Until 12:00 · Please do not disturb", items: [{ label: "Next", note: "Partner briefing", value: "12:30" }] }],
    ["Training timetable", "agenda", "clinic", { eyebrow: "Onboarding week", title: "Your first day", items: [{ value: "09:30", label: "Welcome breakfast", note: "Café, ground floor" }, { value: "10:30", label: "Systems & access", note: "IT desk" }, { value: "12:00", label: "Lunch with your team" }, { value: "14:00", label: "Product walkthrough", note: "Experience centre" }, { value: "16:00", label: "Q&A with leadership" }] }],
    ["Class schedule", "list", "forest", { eyebrow: "Monday", title: "Lecture halls", items: [{ label: "Design Thinking", note: "Hall 1 · Prof. Rao", value: "09:00" }, { label: "Data & Society", note: "Hall 2 · Dr. Shah", value: "10:30" }, { label: "Material Studies", note: "Studio 4", value: "12:00" }, { label: "Interaction Design", note: "Lab 2", value: "14:00" }, { label: "Studio critique", note: "Main studio", value: "16:00" }] }],
    ["Fitness classes", "list", "ember", { eyebrow: "This week", title: "Studio classes", items: [{ label: "Sunrise yoga", note: "Mon · Wed · Fri", value: "07:00" }, { label: "HIIT", note: "Tue · Thu", value: "12:30" }, { label: "Spin", note: "Mon · Thu", value: "18:00" }, { label: "Pilates", note: "Wed", value: "18:30" }, { label: "Stretch & breathe", note: "Fri", value: "17:30" }] }],
    ["Shuttle times", "list", "ocean", { eyebrow: "Shuttle service", title: "Next departures", items: [{ label: "Metro station", note: "Gate 2", value: "5 min" }, { label: "Airport", note: "Gate 1", value: "18 min" }, { label: "City centre", note: "Gate 2", value: "25 min" }, { label: "Tech park", note: "Gate 3", value: "40 min" }] }],
    ["Workshop rotation", "agenda", "violet", { eyebrow: "Hands-on", title: "Studio rotation", items: [{ value: "Round 1", label: "Projection mapping", note: "Studio A" }, { value: "Round 2", label: "Spatial audio", note: "Studio B" }, { value: "Round 3", label: "Interactive floors", note: "Studio C" }, { value: "Round 4", label: "Show & tell", note: "Main hall" }] }],
    ["Weekly plan", "stats", "mono", { eyebrow: "This week", title: "Three things to know", items: [{ value: "Mon", label: "Sprint planning", note: "10:00 · All teams" }, { value: "Wed", label: "Client demo day", note: "Experience centre" }, { value: "Fri", label: "Team lunch", note: "Terrace · 13:00" }] }],
  ],
  announce: [
    ["Big news", "hero", "nex", { eyebrow: "Announcement", title: "Something big\nis coming", body: "Watch this space — all will be revealed on Friday.", brand: "Your logo" }],
    ["New office", "photo", "mono", { eyebrow: "We've moved", title: "Our new home\nis open", body: "Floors 8 – 12, Horizon Tower. Same people, much better coffee.", images: pics("cafeTables") }],
    ["Policy update", "editorial", "clinic", { eyebrow: "Update", title: "Hybrid working,\nrefreshed", body: "From 1 April, team days move to Tuesday and Thursday. Details on the intranet.", footer: "People Operations" }],
    ["Press coverage", "quote", "ivory", { title: "One of the most thoughtfully designed brand spaces in the country.", eyebrow: "Design Weekly", body: "March issue" }],
    ["Milestone", "bigStat", "violet", { eyebrow: "Milestone", value: "1M", title: "visitors through\nour doors", body: "Thank you to everyone who made it happen." }],
    ["New partnership", "split", "ocean", { eyebrow: "Partnership", title: "Together with\nLumen Labs", body: "Bringing adaptive lighting to every experience we build.", images: pics("meeting") }],
    ["Award win", "frame", "gold", { eyebrow: "Proud winners of", title: "Best Brand\nExperience 2026", body: "Recognised for the Horizon flagship store.", footer: "International Design Awards" }],
    ["Simple message", "editorial", "mono", { title: "Make it simple.\nMake it memorable.", body: "Our design principles, on every screen this month.", brand: "Your logo" }],
    ["Survey", "split", "blush", { eyebrow: "Have your say", title: "Two minutes,\nbig difference", body: "Tell us how we're doing — scan the code to take the staff survey.", cta: "Closes Friday", images: pics("laptopTyping") }],
    ["IT maintenance", "notice", "clinic", { eyebrow: "Planned maintenance", value: "i", title: "Systems offline\nSaturday night", body: "Email and the intranet will be unavailable from 22:00 to 02:00.", items: [{ label: "Save your work before you leave" }, { label: "VPN stays online" }], footer: "Questions? IT desk · ext. 4400" }],
  ],
  corporate: [
    ["Quarterly results", "stats", "nex", { eyebrow: "Q3 2026", title: "A record quarter", items: [{ value: "₹48Cr", label: "Revenue", note: "+22% year on year" }, { value: "312", label: "New clients" }, { value: "96%", label: "Retention" }, { value: "18", label: "Launches" }] }],
    ["Sales target", "goal", "ocean", { eyebrow: "Q4 target", title: "Road to ₹60 crore", value: "72%", body: "₹43.2 crore closed so far — 38 days to go.", progress: 0.72, items: [{ value: "₹4.1Cr", label: "This week" }, { value: "126", label: "Deals won" }, { value: "#1", label: "West region" }] }],
    ["Safety record", "bigStat", "signal", { eyebrow: "Site safety", value: "214", title: "days without\na lost-time incident", body: "Keep it going. Report every near miss." }],
    ["Mission", "editorial", "slate", { eyebrow: "Our mission", title: "Make every space\nspeak for the\nbrand inside it", brand: "Your logo" }],
    ["Values", "cards", "mono", { eyebrow: "How we work", title: "Our values", items: [{ value: "01", label: "Craft", note: "Sweat the details nobody asked for" }, { value: "02", label: "Candour", note: "Say it kindly, say it early" }, { value: "03", label: "Curiosity", note: "Every brief is a chance to learn" }], images: pics("gadgets", "meeting", "book") }],
    ["Sustainability", "stats", "forest", { eyebrow: "Sustainability report", title: "Progress on our pledge", items: [{ value: "-41%", label: "Carbon since 2020" }, { value: "100%", label: "Renewable power" }, { value: "0", label: "Waste to landfill" }] }],
    ["Customer score", "bigStat", "clinic", { eyebrow: "Customer satisfaction", value: "4.8", title: "out of 5 from\n2,140 reviews", body: "Thank you for every conversation that got us here." }],
    ["Project pipeline", "list", "nex", { eyebrow: "Delivery", title: "Live projects", items: [{ label: "Horizon flagship", note: "Mumbai", value: "Install" }, { label: "Northwind HQ", note: "Bengaluru", value: "Design" }, { label: "Airport lounge", note: "Delhi", value: "Testing" }, { label: "Museum wing", note: "Jaipur", value: "Content" }, { label: "Campus hub", note: "Pune", value: "Handover" }] }],
    ["Leaderboard", "list", "violet", { eyebrow: "This month", title: "Top performers", items: [{ label: "1.  West region", value: "₹12.4Cr" }, { label: "2.  South region", value: "₹10.9Cr" }, { label: "3.  North region", value: "₹9.7Cr" }, { label: "4.  East region", value: "₹7.2Cr" }] }],
    ["Growth story", "goal", "nex", { eyebrow: "Hiring", title: "Growing the team", value: "84 / 120", body: "New colleagues joined this year.", progress: 0.7, items: [{ value: "32", label: "Engineers" }, { value: "21", label: "Designers" }, { value: "31", label: "Delivery" }] }],
  ],
  people: [
    ["Employee spotlight", "profile", "nex", { eyebrow: "Spotlight", title: "Rahul Verma", value: "Lead Technologist · 8 years", body: "“I still get a kick out of the moment a wall comes alive for the first time.”", images: pics("portraitField") }],
    ["New joiners", "cards", "blush", { eyebrow: "Say hello", title: "Welcome to the team", items: [{ value: "Design", label: "Meera Pillai", note: "Senior Designer" }, { value: "Delivery", label: "Arjun Nair", note: "Project Manager" }, { value: "Engineering", label: "Sara Thomas", note: "Developer" }], images: pics("portraitSunset", "photographer", "portraitField") }],
    ["Birthday", "hero", "blush", { eyebrow: "Happy birthday", title: "Neha!", body: "Cake in the café at 4 — come and celebrate.", footer: "From all of us" }],
    ["Work anniversary", "frame", "gold", { eyebrow: "Celebrating", title: "10 years\nwith Vikram", body: "A decade of brilliant work. Thank you.", footer: "Join us in the lounge at 5 PM" }],
    ["Team shout-out", "quote", "violet", { title: "Huge thanks to the install crew who worked through the weekend to open Horizon on time.", eyebrow: "Shout-out", body: "From the leadership team" }],
    ["We're hiring", "split", "nex", { eyebrow: "We're hiring", title: "Build the next\nexperience with us", body: "Open roles in design, engineering and delivery.", cta: "Scan to apply", images: pics("laptopCoffee") }],
    ["Wellbeing", "editorial", "forest", { eyebrow: "Wellbeing week", title: "Take a breath.\nTake a walk.", body: "Guided walks at 1 PM, mindfulness at 5 PM, all week.", footer: "Sign up with People Ops" }],
    ["Team photo wall", "mosaic", "ivory", { eyebrow: "Offsite 2026", title: "Two days, one team", body: "Thanks for the laughs — photos on the shared drive.", images: pics("benchFriends", "picnic", "balloon") }],
    ["Leadership note", "quote", "slate", { title: "Our best work happens when we're brave enough to show it unfinished.", eyebrow: "Managing Director", body: "From this month's all-hands" }],
    ["Volunteer day", "photo", "forest", { eyebrow: "Give back", title: "Volunteer day\nis 12 June", body: "Choose from tree planting, teaching or the food bank.", images: pics("forest") }],
  ],
  retail: [
    ["Seasonal sale", "promo", "red", { eyebrow: "Summer sale", value: "30%", title: "off everything", body: "In store and online, this weekend only.", cta: "Shop now", items: [{ label: "Ends Sunday" }], images: pics("heels") }],
    ["New arrival", "split", "mono", { eyebrow: "Just landed", title: "The Autumn\nCollection", body: "Thirty new pieces, designed to be worn for years.", cta: "Level 1", images: pics("autumn") }],
    ["Flash deal", "promo", "signal", { eyebrow: "Today only", value: "2 for 1", title: "on all accessories", body: "While stocks last.", cta: "Ask our team", items: [{ label: "Flash deal" }], images: pics("flatlay") }],
    ["Member offer", "promo", "violet", { eyebrow: "Members", value: "₹500", title: "off your next visit", body: "Show your app at checkout.", cta: "Join free", images: pics("coffee") }],
    ["Product hero", "photo", "nex", { eyebrow: "Introducing", title: "Model Five", body: "Lighter, faster and built to last.", images: pics("camera") }],
    ["Price list", "list", "ivory", { eyebrow: "Services", title: "Price list", items: [{ label: "Consultation", note: "30 minutes", value: "Free" }, { label: "Fitting", note: "In-store", value: "₹1,500" }, { label: "Custom order", note: "4 – 6 weeks", value: "₹9,000" }, { label: "Repair", note: "Per item", value: "₹800" }, { label: "Gift wrap", value: "₹200" }] }],
    ["Store hours", "list", "slate", { eyebrow: "Opening hours", title: "We're open", items: [{ label: "Monday – Friday", value: "10 – 21" }, { label: "Saturday", value: "10 – 22" }, { label: "Sunday", value: "11 – 20" }, { label: "Public holidays", value: "11 – 18" }] }],
    ["Bestsellers", "cards", "red", { eyebrow: "Customer favourites", title: "Bestsellers", items: [{ value: "₹4,990", label: "The Classic", note: "Our most-loved design" }, { value: "₹6,490", label: "The Weekender", note: "Built for travel" }, { value: "₹2,990", label: "The Essential", note: "Everyday, every day" }], images: pics("camera", "camperVan", "flatlay") }],
    ["Loyalty", "bigStat", "blush", { eyebrow: "Rewards", value: "2×", title: "points every\nweekend", body: "Double points on everything, Saturday and Sunday." }],
    ["Click & collect", "split", "clinic", { eyebrow: "Click & collect", title: "Order online,\npick up in 2 hours", body: "Collection desk is by the main entrance.", cta: "Free", images: pics("phoneLaptop") }],
  ],
  food: [
    ["Café menu", "list", "ivory", { eyebrow: "Café", title: "Today's menu", items: [{ label: "Flat white", note: "Single origin, oat or dairy", value: "₹220" }, { label: "Masala chai", note: "House blend", value: "₹140" }, { label: "Avocado toast", note: "Sourdough, chilli, lime", value: "₹380" }, { label: "Granola bowl", note: "Yoghurt, berries, honey", value: "₹320" }, { label: "Paneer wrap", note: "Mint chutney, pickled onion", value: "₹360" }, { label: "Banana bread", note: "Warm, with butter", value: "₹180" }] }],
    ["Restaurant menu", "list", "gold", { eyebrow: "Dinner", title: "Tasting menu", items: [{ label: "Charred corn soup", note: "Smoked butter, chives" }, { label: "Tandoori cauliflower", note: "Almond, raisin, curry leaf" }, { label: "Coastal fish curry", note: "Raw mango, red rice" }, { label: "Saffron kulfi", note: "Pistachio crumb" }], footer: "Seven courses · ₹3,800 per guest" }],
    ["Dish of the day", "promo", "ember", { eyebrow: "Chef's special", value: "₹450", title: "Smoked butter\nchicken", body: "Slow-cooked overnight. Served with garlic naan.", items: [{ label: "Today" }], images: pics("kitchen") }],
    ["Happy hour", "hero", "ember", { eyebrow: "Every weekday", title: "Happy hour\n5 – 7 PM", body: "Half price on all mocktails and small plates.", footer: "The Terrace Bar" }],
    ["Breakfast", "split", "sand", { eyebrow: "Served 7 – 11", title: "Breakfast\nis on", body: "Fresh juices, hot plates and our famous pancakes.", cta: "Ground floor", images: pics("tea") }],
    ["Canteen hours", "list", "clinic", { eyebrow: "Staff canteen", title: "Meal times", items: [{ label: "Breakfast", value: "08:00 – 10:00" }, { label: "Lunch", value: "12:30 – 14:30" }, { label: "Snacks", value: "16:00 – 17:00" }, { label: "Dinner (late shift)", value: "19:30 – 21:00" }] }],
    ["Weekly specials", "cards", "forest", { eyebrow: "This week", title: "From the kitchen", items: [{ value: "Mon", label: "Thali day", note: "Regional menu, rotating" }, { value: "Wed", label: "Pasta bar", note: "Build your own" }, { value: "Fri", label: "Grill night", note: "On the terrace" }], images: pics("kitchen", "cafePlants", "honey") }],
    ["Drinks list", "list", "nex", { eyebrow: "The bar", title: "Signature drinks", items: [{ label: "Nex Spritz", note: "Elderflower, lime, soda", value: "₹320" }, { label: "Cold brew tonic", note: "Coffee, tonic, orange", value: "₹280" }, { label: "Kokum cooler", note: "Kokum, mint, black salt", value: "₹240" }, { label: "Sparkling water", value: "₹120" }] }],
    ["Room service", "frame", "sand", { eyebrow: "In-room dining", title: "Available\n24 hours", body: "Dial 7 from your room phone or scan the code on the desk.", footer: "Last hot food order 1 AM" }],
  ],
  wayfinding: [
    ["Floor directory", "wayfinding", "nex", { eyebrow: "You are here · Ground floor", title: "Where to?", items: [{ value: "↑", label: "Experience Centre", note: "Level 2" }, { value: "→", label: "Meeting rooms", note: "This floor" }, { value: "←", label: "Café & lounge", note: "This floor" }, { value: "↓", label: "Parking", note: "B1 – B2" }] }],
    ["Event directions", "wayfinding", "signal", { eyebrow: "Conference", title: "This way", items: [{ value: "→", label: "Main stage", note: "Hall A" }, { value: "→", label: "Registration", note: "Foyer" }, { value: "←", label: "Breakout rooms", note: "B1 – B4" }, { value: "↑", label: "Lunch", note: "Terrace" }, { value: "←", label: "Cloakroom" }, { value: "↓", label: "Restrooms" }] }],
    ["Building directory", "list", "slate", { eyebrow: "Horizon Tower", title: "Directory", items: [{ label: "Northwind Holdings", value: "Floor 12" }, { label: "Lumen Labs", value: "Floor 11" }, { label: "Experience Centre", value: "Floor 10" }, { label: "Studio & Workshops", value: "Floor 9" }, { label: "People & Finance", value: "Floor 8" }, { label: "Café & Lounge", value: "Ground" }, { label: "Gym", value: "B1" }, { label: "Parking", value: "B2 – B3" }] }],
    ["Wi-Fi details", "hero", "clinic", { eyebrow: "Guest Wi-Fi", title: "Network: Nex-Guest", body: "Password: welcome2026 · or scan the code at reception", brand: "Your logo" }],
    ["Campus map key", "wayfinding", "forest", { eyebrow: "Campus", title: "Find your way", items: [{ value: "A", label: "Admissions", note: "Main hall" }, { value: "L", label: "Library", note: "North quad" }, { value: "S", label: "Student centre", note: "East wing" }, { value: "H", label: "Health clinic", note: "Gate 3" }] }],
    ["Hospital wayfinding", "wayfinding", "clinic", { eyebrow: "Level 1", title: "Departments", items: [{ value: "→", label: "Outpatients", note: "Zone A" }, { value: "→", label: "Radiology", note: "Zone B" }, { value: "←", label: "Pharmacy", note: "Zone C" }, { value: "↑", label: "Wards", note: "Levels 2 – 5" }, { value: "←", label: "Café" }] }],
    ["Queue status", "nowNext", "ocean", { eyebrow: "Service desk", title: "Now serving\nA-042", body: "Please have your token ready.", items: [{ label: "Wait", note: "Average wait time", value: "8 min" }] }],
    ["Hotel amenities", "list", "gold", { eyebrow: "Amenities", title: "During your stay", items: [{ label: "Pool", note: "Level 5", value: "6 – 22" }, { label: "Spa", note: "Level 4", value: "9 – 21" }, { label: "Gym", note: "Level 5", value: "24 h" }, { label: "Business centre", note: "Lobby", value: "8 – 20" }, { label: "All-day dining", note: "Ground", value: "6 – 23" }] }],
    ["Parking info", "bigStat", "signal", { eyebrow: "Parking · Level B1", value: "128", title: "spaces free\nright now", body: "EV charging bays at the north ramp." }],
  ],
  safety: [
    ["Emergency exits", "notice", "signal", { eyebrow: "Emergency", title: "In an emergency,\nuse the stairs", body: "Do not use the lifts. Follow the green exit signs to the assembly point.", items: [{ label: "Assembly point: front car park" }, { label: "Fire wardens wear yellow vests" }], footer: "Emergency line · 112" }],
    ["PPE required", "notice", "signal", { eyebrow: "Site rules", title: "Safety gear\nbeyond this point", items: [{ label: "Hard hat" }, { label: "High-visibility vest" }, { label: "Safety boots" }, { label: "Eye protection" }], footer: "No PPE, no entry" }],
    ["Fire drill", "notice", "ember", { eyebrow: "Notice", title: "Fire drill today\nat 3:00 PM", body: "When the alarm sounds, leave by the nearest exit and gather in the front car park.", footer: "Expected to last 15 minutes" }],
    ["Wet floor", "hero", "signal", { eyebrow: "Caution", title: "Wet floor", body: "Cleaning in progress — please use the side corridor." }],
    ["Hand hygiene", "notice", "clinic", { eyebrow: "Health", value: "+", title: "Clean hands\nsave lives", body: "Sanitiser stations are at every entrance and lift lobby.", items: [{ label: "Wash for 20 seconds" }, { label: "Sanitise before and after meetings" }] }],
    ["Visitor rules", "notice", "slate", { eyebrow: "Visitors", value: "i", title: "Keep your pass\nvisible", body: "Please stay with your host at all times.", items: [{ label: "Photography by permission only" }, { label: "Return your pass on exit" }] }],
    ["Quiet zone", "frame", "sand", { eyebrow: "Library", title: "Quiet zone", body: "Phones on silent. Calls in the booths by the stairs.", footer: "Thank you" }],
    ["CCTV notice", "notice", "slate", { eyebrow: "Information", value: "i", title: "CCTV in operation", body: "Images are recorded for safety and security purposes.", footer: "Data controller: Facilities team" }],
    ["Weather alert", "notice", "ocean", { eyebrow: "Weather alert", value: "!", title: "Heavy rain\nexpected at 5 PM", body: "Leave early if you can. Shuttles run every 10 minutes from 4 PM.", footer: "Updated 1:30 PM" }],
  ],
  launch: [
    ["Launch countdown", "countdown", "nex", { eyebrow: "The wait is almost over", title: "Launching in", body: "Friday 21 November · 7:00 PM · Main stage", brand: "Your logo" }],
    ["Opening soon", "photoCenter", "mono", { eyebrow: "Opening soon", title: "The Horizon\nFlagship", body: "December 2026 · Linking Road, Mumbai", images: pics("cityStreet") }],
    ["Event countdown", "countdown", "violet", { eyebrow: "Summit 2026", title: "See you in", items: [{ label: "Days", value: "05" }, { label: "Hours", value: "14" }, { label: "Minutes", value: "22" }], body: "Register at summit.example.com" }],
    ["Product reveal", "hero", "violet", { eyebrow: "Introducing", title: "Nex One", body: "The screen that knows its room.", cta: "Live demo at 4 PM" }],
    ["Coming soon", "editorial", "red", { eyebrow: "Coming soon", title: "Something\nnew is\nbeing built", body: "Pardon the dust — we're making this space better.", footer: "Reopening March", brand: "Your logo" }],
    ["New year countdown", "countdown", "gold", { eyebrow: "Celebrate with us", title: "New Year's Eve", items: [{ label: "Hours", value: "03" }, { label: "Minutes", value: "15" }, { label: "Seconds", value: "00" }], body: "Rooftop · Live music from 9 PM" }],
    ["Grand opening", "frame", "gold", { eyebrow: "You're invited to the", title: "Grand Opening", body: "Ribbon cutting, tours and refreshments.", footer: "Saturday 6 December · 11 AM" }],
    ["Feature launch", "split", "ocean", { eyebrow: "New", title: "Live scheduling\nis here", body: "Push content to any screen at any time — now from your phone.", cta: "Ask for a demo", images: pics("phone") }],
  ],
  celebrate: [
    ["Diwali", "frame", "gold", { eyebrow: "Wishing you a", title: "Happy Diwali", body: "May the festival of lights bring joy, health and prosperity.", footer: "From all of us" }],
    ["Holiday greetings", "hero", "forest", { eyebrow: "Season's greetings", title: "Happy Holidays", body: "Thank you for a wonderful year together.", footer: "Office closed 25 Dec – 1 Jan" }],
    ["Eid", "frame", "forest", { eyebrow: "Wishing you", title: "Eid Mubarak", body: "Peace, joy and togetherness to you and your family." }],
    ["New year", "photoCenter", "gold", { eyebrow: "Here's to", title: "2027", body: "New ideas, new spaces, new stories.", images: pics("sunset") }],
    ["Women's day", "hero", "blush", { eyebrow: "8 March", title: "International\nWomen's Day", body: "Celebrating the women who build, design and lead here.", footer: "Panel and lunch · Atrium · 1 PM" }],
    ["Anniversary", "bigStat", "gold", { eyebrow: "Celebrating", value: "20", title: "years of building\nexperiences", body: "2006 – 2026. Thank you for being part of the story." }],
    ["Holi", "hero", "ember", { eyebrow: "Let's celebrate", title: "Happy Holi", body: "Colours on the lawn at 4 PM. White T-shirts provided!" }],
    ["Thank you", "frame", "ivory", { eyebrow: "Thank you", title: "For visiting us\ntoday", body: "We hope you enjoyed the experience. See you again soon." }],
    ["Independence day", "hero", "clinic", { eyebrow: "15 August", title: "Happy\nIndependence Day", body: "Flag hoisting at 9 AM on the front lawn." }],
    ["Christmas", "photoCenter", "forest", { eyebrow: "Merry Christmas", title: "Season's\nGreetings", body: "Carols in the atrium, Friday at 5 PM.", images: pics("stringLights") }],
  ],
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = TEMPLATE_CATEGORIES.flatMap(({ id: category }) =>
  LIB[category].map(([label, layout, theme, copy]) => ({
    id: `${category}-${slug(label)}`,
    label,
    category,
    layout,
    theme,
    build: (W: number, H: number) => LAYOUTS[layout](W, H, CANVAS_THEMES[theme], copy),
  }))
);
