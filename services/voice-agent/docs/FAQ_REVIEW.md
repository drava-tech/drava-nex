# Travis FAQ: review draft

DRAFT for review. Nothing is wired in: no code, config, routing or prompt was changed, and ElevenLabs was not called. Files: `knowledge/faq.yaml` (entries) and this report.

27 FAQ entries (company 11, cms 9, travis 4, experience_center 3) and 12 `no_info` entries, 271 variants in all.

## How this was drafted

- Facts: only `knowledge/cms_platform.md`, `knowledge/the_white_tusker.md` and `knowledge/travis.md`.
- Real questions: `logs/exchanges.jsonl` has 317 lines. Only about 12 distinct knowledge questions were in it (company overview in several phrasings, "tell me about CMS", "what is the Travis control system", "can I know what you control", "tell me more"). Everything else was device commands or noise. So the topic mix follows the knowledge sections more than the logs. Phrasings taken from the logs: "Tell me about CMS", "What is the Travis control system", "Can I know what you control", "Tell me about your company".
- **`docs/CONVERSATION_STATUS.md` does not exist** in the repo (searched the whole tree). The answer rules I followed are the ones in `agent/knowledge_answer.py` (RULES, contact line, `without_contact`) and your brief. Please point me at the file if it lives elsewhere.
- This report is in `services/voice-agent/docs/`, not the repo-root `docs/`, to stay inside the voice-agent folder.
- Your brief was cut off after "and an empty". I added an empty **Review notes** column to each table; tell me if you meant something else.

## FAQ entries

| # | id | topic | sample variants | answer | sources | grounding | Review notes |
|---|---|---|---|---|---|---|---|
| 1 | company_overview | company | What is White Tusker; Tell me about White Tusker; Tell me about your company (+5 more) | White Tusker is a brand experience design studio. We design, connect, create and control the complete experience, with spaces that respond to people, content, data and events. | the_white_tusker.md: Who we are [adds email line] | 1.00 | |
| 2 | company_approach | company | What is your tagline; What is your philosophy; What is your approach to design (+4 more) | Our tagline is Fluid by Nature, Adaptive by Design. Our approach is that space is language, technology is a tool, and story is the primary driver. | the_white_tusker.md: Who we are | 1.00 | |
| 3 | company_verticals | company | What services do you offer; What are your verticals; What are the areas of your business (+5 more) | Our three verticals are architecture and interior spaces, immersive and interactive technology, and brand solutions. | the_white_tusker.md: Our three verticals | 1.00 | |
| 4 | company_clients | company | Who are your clients; Which clients have you worked with; Which all companies you have worked with (+5 more) | Our clients are Boeing, Collins Aerospace, Bosch, Volvo, Tata Steel, DIAGEO, Infosys, Tech Mahindra, NTT Data, PETRONAS, Herbalife, Embassy and others, across technology, aerospace, automotive and corporate sectors. | the_white_tusker.md: Clients | 1.00 | |
| 5 | company_projects | company | What projects have you done; Tell me about your projects; Which all projects you have done (+6 more) | Our flagship is the Collins Aerospace campus in Bengaluru, an experience centre that takes visitors through a flight from check-in to boarding. For Tata Steel we built a digital twin of the Jamshedpur plant with real-time data. | the_white_tusker.md: Projects | 1.00 | |
| 6 | company_other_projects | company | Which experience centres have you designed; Have you done work for Boeing; Did you design anything for Volvo (+5 more) | We have also designed experience centres for Boeing, Volvo, Bosch India, Lamborghini Super Trofeo, Johnnie Walker and NTT Data, and made films for Tanishq and SAP. | the_white_tusker.md: Projects | 1.00 | |
| 7 | company_founders | company | Who founded White Tusker; Who are the founders; Founders (+5 more) | White Tusker was founded by Smriti Attavar, Naveen DC and Varun Parikh. All three are directors of the studio and together lead its three verticals. | the_white_tusker.md: Founders and leadership | 1.00 | |
| 8 | company_team | company | Tell me about your team; Who works at White Tusker; What kind of people work there (+5 more) | Our team brings architects, interior designers, developers, motion artists, filmmakers and brand designers together in one studio in Indiranagar, Bengaluru. One project can move from spatial design to custom software to a brand film. | the_white_tusker.md: Team | 1.00 | |
| 9 | company_culture | company | What is your culture; What values do you follow; Tell me about your work culture (+3 more) | Our culture starts with one habit. We do not just follow briefs, we question them. Nobody works in a silo. | the_white_tusker.md: Team | 1.00 | |
| 10 | company_how_we_work | company | How do you work; What is your process; How do you take a project from brief to finish (+5 more) | We take projects from brief to install under one roof. We start by questioning the brief to find the story, design the space, content and technology together, and handle detailing, fabrication and on-site installation ourselves. | the_white_tusker.md: How we work | 1.00 | |
| 11 | company_location_contact | company | Where are you located; Where is your studio; In which city is White Tusker based (+5 more) | Our studio is in Indiranagar, Bengaluru, India. | the_white_tusker.md: Where and how to reach us [adds email line] | 1.00 | |
| 12 | cms_what_is | cms | What is the CMS; Tell me about CMS; What is this CMS only (+5 more) | The CMS is the control system for this experience centre, built by White Tusker. From one web page, an operator controls what plays on every screen, runs interactive experiences, and operates the room itself. | cms_platform.md: What the CMS is | 1.00 | |
| 13 | cms_screens | cms | How are the screens managed in the CMS; Can each screen be controlled separately; What happens when there is a power cut (+2 more) | Every screen is controlled on its own. An operator can show an experience or media item, queue videos, pause, skip, blank or reset it. If a screen loses power or network, it comes back showing what it was meant to show. | cms_platform.md: Screens | 1.00 | |
| 14 | cms_experiences | cms | What is an experience in the CMS; What kind of experiences are there; What templates do you have (+5 more) | An experience is interactive content built from a template, such as a welcome screen, a portfolio, a product showcase, a gallery, a flight simulation, a live stream or object recognition. Operators edit its content with a live preview. | cms_platform.md: Experiences | 1.00 | |
| 15 | cms_media | cms | What is the media library; What kind of media can I upload; Can I add videos and presentations (+5 more) | The media library holds videos, images and documents such as presentations. Media can be uploaded, added from a web link, or arrive as an email attachment. An operator pushes an item to one or more screens, or queues several to play one after another. | cms_platform.md: Media and presentations | 1.00 | |
| 16 | cms_room_controls | cms | What room equipment does the CMS run; Does the CMS control the room; What does the CMS control besides content (+5 more) | The CMS also runs the room's equipment. Operators can switch lights on and off, set brightness and colour, change the air conditioning, adjust the TV volume with its remote, and lock or unlock the door. | cms_platform.md: Controlling the room | 1.00 | |
| 17 | cms_room_modes | cms | What are the room modes; What lighting modes are there; What lighting is used before a visitor enters (+5 more) | The room has ready-made lighting modes for the stages of a visit, pre entry, entry, meeting and presentation. Choosing a mode sets the lights for that moment in one step, and the operator can adjust the light levels afterwards. | cms_platform.md: Room modes | 1.00 | |
| 18 | cms_products_portfolio | cms | Does the CMS store product details; Where is the portfolio kept; What is the product showcase (+4 more) | The CMS keeps product details with their features, specifications and media, which feed the product showcase. It also holds the White Tusker portfolio, organised by verticals, companies and projects, which can be shown on the main screen. | cms_platform.md: Products and portfolio | 1.00 | |
| 19 | cms_whiteboards | cms | Does the CMS have whiteboards; Can we draw live during a meeting; Is there a whiteboard feature (+4 more) | Operators can create multi page whiteboards and draw on them live. The strokes appear on the chosen screens as they are drawn, so a screen can be used like a shared board during a meeting. | cms_platform.md: Whiteboards | 1.00 | |
| 20 | cms_who_can_use | cms | Who can use the CMS; Who are the users of the CMS; Do I need to sign in (+5 more) | Operators sign in from a web browser. The CMS has users and roles, so administrators can create and edit content while others only operate the room. The screens themselves need no sign in. | cms_platform.md: Who can use it | 1.00 | |
| 21 | travis_what_is | travis | Who is Travis; What is Travis; Tell me about Travis (+5 more) | Travis is the voice assistant built by White Tusker. It controls this space, the lights, AC, the door, and what plays on each screen. | travis.md: About Travis | 1.00 | |
| 22 | travis_controls | travis | What does Travis control; What all can you control; Can I know what you control (+4 more) | Travis controls the lights, AC, the door, and what plays on each screen. It uses the same controls as the CMS, which also adjust the TV volume. | travis.md: About Travis; cms_platform.md: Controlling the room | 1.00 | |
| 23 | travis_how_to_talk | travis | How do I talk to Travis; How do I give a command to Travis; How do I use Travis (+5 more) | Say Hey Travis, then a request, such as set the AC to twenty two, lock the door or lower the volume. Travis can also show an experience or media item on a screen. | cms_platform.md: What you can say to Travis | 0.93 | |
| 24 | travis_and_cms | travis | Is Travis part of the CMS; How is Travis connected to the CMS; Does Travis use the CMS (+3 more) | Travis uses the same controls as the CMS, so what you ask Travis to do is what the CMS does. | cms_platform.md: Controlling the room | 1.00 | |
| 25 | exp_what_is_this | experience_center | What is this place; What is this experience centre; What kind of place is this (+5 more) | This is an experience centre. From one web page, an operator controls what plays on every screen, runs interactive experiences, and operates the lights, air conditioning, sound and the door. | cms_platform.md: What the CMS is; cms_platform.md: Controlling the room | 1.00 | |
| 26 | exp_room_equipment | experience_center | What equipment is in this room; What equipment is installed in this room; Which devices are in the room (+4 more) | The room has screens, lights, air conditioning, sound and a door, which an operator runs from one web page. Travis controls the lights, AC, the door and what plays on each screen. | cms_platform.md: What the CMS is; cms_platform.md: Screens; cms_platform.md: Controlling the room; travis.md: About Travis | 1.00 | |
| 27 | exp_what_to_see | experience_center | What can I see here; What will I experience here; What kind of content plays here (+4 more) | The screens can show an experience such as a welcome screen, a portfolio, a product showcase, a gallery, a flight simulation, a live stream or object recognition. An operator picks videos, images and presentations from the media library. | cms_platform.md: Screens; cms_platform.md: Experiences; cms_platform.md: Media and presentations | 1.00 | |

## no_info entries

| # | id | topic | sample variants | answer | offers | Review notes |
|---|---|---|---|---|---|---|
| 1 | ni_founding_year | company | When was White Tusker founded; Since when are you in business; How old is the company (+3 more) | I don't have that detail. I can tell you about our founders if you like. | our founders | |
| 2 | ni_awards | company | Have you won any awards; What awards do you have; Any recognitions (+2 more) | I don't have that detail. I can tell you about our projects if you like. | our projects | |
| 3 | ni_pricing | company | How much do you charge; What is the price of the CMS; How much does the CMS cost (+4 more) | I don't have that detail. I can tell you about what the CMS is if you like. [adds email line] | what the CMS is | |
| 4 | ni_timeline | company | How long does a project take; What is the timeline for a project; How many months will it take (+2 more) | I don't have that detail. I can tell you about how we work if you like. | how we work | |
| 5 | ni_careers | company | Are you hiring; Do you have job vacancies; How can I apply for a job (+3 more) | I don't have that detail. I can tell you about our team if you like. [adds email line] | our team | |
| 6 | ni_office_hours | company | What are your office hours; What are your timings; Are you available on Sundays (+3 more) | I don't have that detail. I can tell you about where we are if you like. [adds email line] | where we are | |
| 7 | ni_team_size | company | How many people are there in the studio; How big is your team; How many employees do you have (+2 more) | I don't have that detail. I can tell you about our team if you like. | our team | |
| 8 | ni_other_offices | company | Do you have offices in other cities; Do you have a branch abroad; Do you work outside India (+2 more) | I don't have that detail. I can tell you about where we are if you like. [adds email line] | where we are | |
| 9 | ni_phone_social | company | What is your phone number; Can I call you; Do you have WhatsApp (+2 more) | I don't have that detail. I can tell you about where we are if you like. [adds email line] | where we are | |
| 10 | ni_cms_technical | cms | Which technology stack does the CMS use; Is the CMS cloud based; Does the CMS work on mobile (+3 more) | I don't have that detail. I can tell you about who can use it if you like. | who can use it | |
| 11 | ni_cms_purchase | cms | Can I buy the CMS; Can I get a demo of the CMS; Do you sell the CMS to other companies (+2 more) | I don't have that detail. I can tell you about screens if you like. [adds email line] | screens | |
| 12 | ni_travis_technical | travis | Which languages does Travis speak; Does Travis speak Hindi; Is Travis artificial intelligence (+3 more) | I don't have that detail. I can tell you what you can say to Travis if you like. | what you can say to Travis | |

## Self-check results

### 1. Grounding (`safety.reply_guard.grounding`, threshold `knowledge_grounding_min` = 0.65)

All 27 answers score at or above the threshold (lowest 0.93). Each answer is scored against the text of the sections it cites, including the section heading (the retriever hands the model the heading too). Scores are in the table above.

Rewritten during drafting because the first pass scored lower: company_verticals 0.73, exp_room_equipment 0.77, exp_what_is_this 0.86, travis_controls 0.90, exp_what_to_see 0.90, cms_screens 0.92 (all now 1.00 except as noted). The check counts words only, not meaning. travis_how_to_talk is 0.93 only because "twenty two" is the spoken form of the "22" in the file.
The `no_info` answers are not graded: they hold no facts. Each offers a real topic label from the files ("say:" comments), checked in code.

### 2. Names and numbers

Every capitalised name and every number in the answers appears in the cited sections (0 missing). Checked in code. Spoken forms: "twenty two" for 22, and hyphens written as spaces ("pre entry", "multi page", "sign in") so they read aloud cleanly. "Titan x Ducati" is left out on purpose (the "x" is a symbol); the Tanishq and SAP films are named.

Judgement calls for you:
- company_location_contact says "Indiranagar, Bengaluru, India". It is the area from the file, not a street address. Remove it if you count that as an address; the answer would then be the email line alone.
- travis_how_to_talk leaves out the file's "cove light" and "main screen" examples so no device name is in an answer.
- exp_what_is_this says this is an experience centre. The file only says the CMS is "for this experience centre"; it describes nothing else about the place.
- company_clients names all 12 clients from the file and ends with "and others", as the file does.

### 3. Overlap between entries (nomic-embed-text)

98 cross-entry variant pairs score 0.80 or higher. nomic-embed-text scores short questions high in general, so I judge on pairs at 0.88 or higher, and on whether a variant is closer to another entry than to its own entry.

Pairs at 0.88 or higher after rewording:

| score | entry A: variant | entry B: variant | action |
|---|---|---|---|
| 0.956 | company_founders: Who founded White Tusker | ni_founding_year: When was White Tusker founded | Kept. "Who founded" (answered) and "when was it founded" (not in the knowledge) differ by one word. A wrong match gives the founders answer to a year question. Please decide how routing should treat it. |
| 0.942 | company_founders: Who established White Tusker | ni_founding_year: When was White Tusker founded | Kept. "Who founded" (answered) and "when was it founded" (not in the knowledge) differ by one word. A wrong match gives the founders answer to a year question. Please decide how routing should treat it. |
| 0.886 | travis_what_is: What is the Travis control system | travis_controls: What does Travis control | Kept. Same topic, adjacent answers, both correct. |
| 0.881 | cms_what_is: What does the CMS do | cms_who_can_use: Who can use the CMS | Kept. Adjacent. |

Reworded or removed during drafting to cut overlap: "Who runs White Tusker" became "Who leads"; removed "Which other projects have you done" (too close to company_projects), "Any other experience centres", "What is this room" (too close to exp_room_equipment), "What experiences are shown here", "How many people work at White Tusker" (too close to company_team), "Careers at White Tusker", and "What is the history of White Tusker" (0.92 to the company overview).

86 of 271 variants have a different entry as nearest neighbour, but only 26 by a margin of 0.08 or more. Those:

| variant (entry) | nearest other variant (entry) | other | own best | note |
|---|---|---|---|---|
| When was White Tusker founded (ni_founding_year) | Who founded White Tusker (company_founders) | 0.956 | 0.567 | |
| Who works at White Tusker (company_team) | Who leads White Tusker (company_founders) | 0.869 | 0.644 | |
| What do you design (company_verticals) | How do you think about design (company_approach) | 0.823 | 0.599 | |
| What is the control system (cms_what_is) | What is the Travis control system (travis_what_is) | 0.724 | 0.552 | |
| Where am I (exp_what_is_this) | Where are you located (company_location_contact) | 0.811 | 0.645 | |
| Tell me about media in the CMS (cms_media) | Tell me about CMS (cms_what_is) | 0.879 | 0.715 | |
| Does the CMS store product details (cms_products_portfolio) | What does the CMS do (cms_what_is) | 0.754 | 0.595 | |
| Which experience centres have you designed (company_other_projects) | What is this experience centre (exp_what_is_this) | 0.810 | 0.657 | |
| Where are the White Tusker projects stored (cms_products_portfolio) | In which city is White Tusker based (company_location_contact) | 0.773 | 0.624 | |
| How big is your team (ni_team_size) | Who all are in your team (company_team) | 0.727 | 0.583 | |
| Have you done work for Boeing (company_other_projects) | Who have you worked for (company_clients) | 0.718 | 0.577 | |
| Can I call you (ni_phone_social) | How can I contact you (company_location_contact) | 0.763 | 0.632 | |
| What interactive content can you make (cms_experiences) | What kind of content plays here (exp_what_to_see) | 0.723 | 0.597 | |
| What model does Travis use (ni_travis_technical) | Which equipment does Travis handle (travis_controls) | 0.870 | 0.752 | |
| What is the budget for a project (ni_pricing) | What is the timeline for a project (ni_timeline) | 0.696 | 0.580 | |
| What kind of people work there (company_team) | Who have you worked for (company_clients) | 0.753 | 0.644 | |
| Do you work in silos (company_culture) | Which areas do you work in (company_verticals) | 0.672 | 0.567 | |
| Who does the fabrication (company_how_we_work) | What kind of people work there (company_team) | 0.594 | 0.495 | |
| What is the Travis control system (travis_what_is) | What does Travis control (travis_controls) | 0.886 | 0.787 | |
| What all do you do (company_verticals) | Which all projects you have done (company_projects) | 0.713 | 0.618 | |
| Can a screen be used as a shared board (cms_whiteboards) | Can each screen be controlled separately (cms_screens) | 0.751 | 0.662 | |
| What content can this centre present (exp_what_to_see) | What is this centre (exp_what_is_this) | 0.793 | 0.705 | |
| What files does the CMS support (cms_media) | Who can use the CMS (cms_who_can_use) | 0.802 | 0.715 | |
| What is this platform (cms_what_is) | What technology is in this room (exp_room_equipment) | 0.621 | 0.537 | |
| What is your phone number (ni_phone_social) | How can I contact you (company_location_contact) | 0.715 | 0.632 | |
| How do I speak to you (travis_how_to_talk) | How can I contact you (company_location_contact) | 0.797 | 0.717 | |

The rest are small margins, mostly one-noun differences ("your company" / "your team" / "your projects") that a short embedding cannot separate well. The heading boost in `rag/retriever.py` may handle them; test with the real matcher before relying on the embedding alone.

### 4. Command collisions

Compared against 4977 phrases expanded from `config/commands.json` (slots filled with sample values) plus 197 bench utterances that expect a device or screen action.

- Action words (turn, switch, set, play, open, close, lock, unlock, increase, decrease, mute, start, stop, show): **0 variants** contain one.
- Real command matcher (`nlu.command_matcher.match_command`, exact and fuzzy): **0 of 271 variants** match any command.
- Device names (every alias in the `light` and `screenAlias` slots, plus ac, door, tv, light(s), screen(s), display): none are in any answer. The generic word "screen" remains in 4 variants where the question is about screens and cannot be asked without it:
  - cms_screens: "How are the screens managed in the CMS"
  - cms_screens: "Can each screen be controlled separately"
  - cms_screens: "Tell me about screens in the CMS"
  - cms_whiteboards: "Can a screen be used as a shared board"
- Reworded to stay clear of commands: the room-mode questions (they were 0.96 to 0.99 similar to the command phrases "pre-entry mode", "meeting mode" and "presentation mode"), and "start" / "set up" in two variants.
- Closest remaining by embedding, to bench phrases that are information requests or greetings, not device actions:

| score | FAQ variant (entry) | bench or command phrase | note |
|---|---|---|---|
| 0.884 | Can each screen be controlled separately (cms_screens) | which screens can you control | |
| 0.854 | What all can you control (travis_controls) | what all devices can you control | |
| 0.854 | Which devices are in the room (exp_room_equipment) | what the devices are there | |
| 0.821 | What is Travis (travis_what_is) | greetings travis | |
| 0.819 | Can it control brightness and colour (cms_room_controls) | what light can you control | |
| 0.814 | Who is Travis (travis_what_is) | greetings travis | |
| 0.812 | What all do you do (company_verticals) | what do you do | |
| 0.812 | What equipment can operators control (cms_room_controls) | what devices can you control | |

The "what can you control" family (travis_controls, exp_room_equipment) sits next to bench phrases that ask for the device list ("what devices can you control"), which today go to `list_inventory`. Decide which one answers: the FAQ lists categories, `list_inventory` lists the real names.

### 5. Coverage

Knowledge sections used by at least one entry: 19 of 19. Unused: **none**.

| section | used by |
|---|---|
| cms_platform.md: What the CMS is | cms_what_is, exp_what_is_this, exp_room_equipment |
| cms_platform.md: Screens | cms_screens, exp_room_equipment, exp_what_to_see |
| cms_platform.md: Experiences | cms_experiences, exp_what_to_see |
| cms_platform.md: Media and presentations | cms_media, exp_what_to_see |
| cms_platform.md: Controlling the room | cms_room_controls, travis_controls, travis_and_cms, exp_what_is_this, exp_room_equipment |
| cms_platform.md: Room modes | cms_room_modes |
| cms_platform.md: Products and portfolio | cms_products_portfolio |
| cms_platform.md: Whiteboards | cms_whiteboards |
| cms_platform.md: Who can use it | cms_who_can_use |
| cms_platform.md: What you can say to Travis | travis_how_to_talk |
| the_white_tusker.md: Who we are | company_overview, company_approach |
| the_white_tusker.md: Our three verticals | company_verticals |
| the_white_tusker.md: Clients | company_clients |
| the_white_tusker.md: Projects | company_projects, company_other_projects |
| the_white_tusker.md: Founders and leadership | company_founders |
| the_white_tusker.md: Team | company_team, company_culture |
| the_white_tusker.md: How we work | company_how_we_work |
| the_white_tusker.md: Where and how to reach us | company_location_contact |
| travis.md: About Travis | travis_what_is, travis_controls, exp_room_equipment |

### Other checks

- All 27 answers: at most 45 words (longest is 44), at most 3 sentences, no digits, brackets or symbols, no "The White Tusker", no email, phone number or web address.
- Every entry has 5 to 10 variants; none contains the wake word. All `next_sections` exist as headings.
- `cms_platform.md` and `the_white_tusker.md` have uncommitted edits in the working tree; the FAQ was checked against that text. Only the two new files are committed.
