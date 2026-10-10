"""Tool declarations the local model may call (JSON-schema style)."""

from __future__ import annotations



# pyrefly: ignore [missing-import]



TOOL_DECLARATIONS = [
    {
        "name": "show_visual",
        "description": (
            "Display an on-screen visual on the agent's screen to help the person "
            "UNDERSTAND something, instead of explaining with words alone. "
            "USE THIS whenever a picture or a step-by-step diagram would explain "
            "better than speech: a how-to, a process, a comparison, or showing a "
            "reference image. "
            "Flow: call action 'show' once with a 'title' and the full list of "
            "'steps' (each a short heading + detail). Then, as you narrate, call "
            "'next' / 'prev' to move the on-screen highlight in sync with what you "
            "are saying, and 'clear' when you are finished so the screen returns to "
            "normal. For a single picture, pass 'image_url' (or 'image_path') and an "
            "optional 'caption' instead of steps. Keep headings and details short; "
            "speak naturally alongside the visual."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": "show | next | prev | clear",
                },
                "title": {
                    "type": "STRING",
                    "description": "Short title shown at the top of the visual.",
                },
                "steps": {
                    "type": "ARRAY",
                    "description": (
                        "Ordered steps for a how-to walkthrough. Provide the whole "
                        "list with action 'show'."
                    ),
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "heading": {
                                "type": "STRING",
                                "description": "Short step title.",
                            },
                            "detail": {
                                "type": "STRING",
                                "description": "One or two sentences of detail.",
                            },
                            "highlight": {
                                "type": "STRING",
                                "description": "Optional key point to emphasise.",
                            },
                        },
                        "required": ["heading"],
                    },
                },
                "image_url": {
                    "type": "STRING",
                    "description": "Optional image URL to display instead of steps.",
                },
                "image_path": {
                    "type": "STRING",
                    "description": "Optional local image file path to display.",
                },
                "caption": {
                    "type": "STRING",
                    "description": "Optional caption shown under an image.",
                },
            },
            "required": ["action"],
        },
    },
    {
        "name": "shutdown_travis",
        "description": (
            "Shuts down the assistant completely. "
            "Call this when the user expresses clear intent to end the "
            "conversation or stop the agent itself — closing the assistant, "
            "not the room. Do NOT call this for 'bye' — that phrase "
            "is device_control's catch-all for turning off the room's "
            "lights and AC (action:'good_night'), even though it sounds "
            "like a sign-off. Only treat a goodbye-style phrase as shutdown "
            "when it's unmistakably about ending the session with YOU "
            "specifically (e.g. 'shut yourself down', 'stop listening', "
            "'that's all from you today'), not just about the room. "
            "The user can say this in ANY language."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {},
        },
    },
    {
        "name": "save_memory",
        "description": (
            "Save an important personal fact about the user to long-term memory. "
            "Call this silently whenever the user reveals something worth remembering: "
            "name, role, preferences, or recurring requests. "
            "Do NOT call for: weather, reminders, searches, or one-time commands. "
            "Do NOT announce that you are saving — just call it silently. "
            "Values must be in English regardless of the conversation language."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "category": {
                    "type": "STRING",
                    "description": (
                        "identity — name, role, language | "
                        "preferences — favorite scenes/screens, preferred lighting, routines | "
                        "notes — anything else worth remembering"
                    ),
                },
                "key": {
                    "type": "STRING",
                    "description": "Short snake_case key (e.g. name, preferred_scene)",
                },
                "value": {"type": "STRING", "description": "Concise value in English"},
            },
            "required": ["category", "key", "value"],
        },
    },
    {
        "name": "knowledge_search",
        "description": (
            "Search the local knowledge base for grounded information about this "
            "CMS deployment: operating hours, or venue FAQs the operator has "
            "documented in writing. Do NOT use this for 'what screens/devices "
            "exist' or 'how many do you have' — that's list_inventory's job, "
            "since this knowledge base is static documentation and can be stale "
            "or generic, while list_inventory always reflects the CMS's real, "
            "current list. ALSO use knowledge_search to recall previously saved "
            "facts about the current user (their name, preferences, ongoing "
            "projects, etc. — anything remembered via save_memory) — nothing is "
            "given to you upfront, so if a request depends on something you might "
            "already know about this person, search for it here first rather than "
            "asking them to repeat it or assuming you don't know. Prefer this over "
            "Google Search for venue/CMS/personal questions; use Google Search only "
            "for general or time-sensitive web facts. If it returns no relevant "
            "info, say you don't have that detail rather than guessing."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {
                    "type": "STRING",
                    "description": "The information need, phrased as a clear search query.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "list_inventory",
        "description": (
            "Answers 'what screens/devices exist', 'how many screens do you "
            "have', 'list the screens', 'what devices can you control' — "
            "returns the CMS's REAL, current inventory (live from the "
            "database), not documentation. Use this instead of knowledge_search "
            "for any question about what actually exists right now. Also useful "
            "before telling a user 'which one did you mean' when a target name "
            "didn't resolve, if you need to see the real options yourself first."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "kind": {
                    "type": "STRING",
                    "description": "'lights' (only the lights) | 'screens' | 'devices' (everything controllable: lights, AC, TV) | 'both'. Use 'lights' when asked for lights, 'screens' when asked for screens. Defaults to 'both' if omitted.",
                },
            },
        },
    },
    {
        "name": "device_control",
        "description": (
            "Controls a physical room device through the CMS: lights, the AC, "
            "any other IR-controlled device such as the TV, or the front door "
            "lock. For the TV, use this ONLY for its remote-control buttons "
            "(power, volume, mute, channel, input): words like stop, pause, "
            "play, skip, show, push, display, idle or reset are about what a "
            "SCREEN is showing, so they belong to screen_control even when "
            "the screen's name contains 'TV' — and 'stop' NEVER means power "
            "off. Only send power when the user says turn on/off/power. "
            "VOLUME: the room's sound comes from the soundbar, which is "
            "controlled through the TV's remote. For ANY louder / quieter / "
            "volume / mute request — however it's aimed ('the soundbar', "
            "'the TV', or just 'volume') — call action:'ac_command' with "
            "command 'Volume Up', 'Volume Down' or 'mute' and params.times "
            "(1 = a nudge, 3 = a normal 'turn it up', 6 = 'a lot'). There is "
            "NO way to set or read an exact volume level, so never state a "
            "volume number or percentage; report only what the tool says. "
            "USE THIS for anything about the room's hardware: 'turn on "
            "the lights', 'turn on tusker L1', 'turn on tusker L2', 'turn on "
            "tusker L3' (controls both fabric lights together), 'dim tusker "
            "edge to 30%', 'turn on tusker ac', 'set tusker ac to 22 degrees', "
            "'turn up the TV volume', 'turn up volume on tusker 86', 'mute tusker 86', 'turn down the soundbar', 'lock the door', "
            "'unlock the door', 'are the lights on'. "
            "For 'bye', 'shut everything down', 'we're done for the "
            "day', or similar catch-all requests to turn the room off "
            "INCLUDING the AC, use action:'good_night' — it turns off every "
            "light and the AC in one call. Its opposite: for 'hi', "
            "'turn everything on', 'let's start the day', use "
            "action:'good_morning' — it turns on every light AND the AC in "
            "one call (the lights come up in pre-entry mode). For "
            "'pre-entry mode', 'entry mode', 'meeting mode' or "
            "'presentation mode', use action:'ambient_mode' with target = "
            "the mode name as said ('pre-entry', 'entry', 'meeting', "
            "'presentation') — lights only, the AC is untouched, and the "
            "colour and brightness are saved settings you never state. "
            "'entry' and 'pre-entry' are different modes. That is triggered by the words alone, never by the "
            "time: say it at 9pm or 3am and it is still a command, so don't "
            "refuse, question or comment on the hour. For 'turn on all the "
            "lights'/'turn on all lights'/'light up the room' (lights only, "
            "no AC implied), use action:'all_lights_on'. For 'turn off all "
            "the lights'/'turn off all lights' (lights only — NOT "
            "good_night, since that phrase says nothing about the AC and "
            "shouldn't switch it off as a side effect), use "
            "action:'all_lights_off'. "
            "Don't enumerate individual lights yourself for any of these "
            "these; the CMS already knows the full device list. "
            "Light fixtures are registered with arbitrary custom names that "
            "don't necessarily contain the word 'light' — a request to turn "
            "on/off/dim/recolor ANY named thing that isn't a known screen "
            "(see screen_control) is a device_control call, never "
            "screen_control, even if the name alone doesn't obviously sound "
            "like a light. "
            "'target' is the device name EXACTLY as the user said it — never "
            "add, drop or change a word or number they didn't say. A name "
            "without a number covers the whole numbered family together (the "
            "CMS applies it to all of them), so don't pick one member "
            "yourself. Not needed for "
            "lock/unlock/good_night/good_morning/all_lights_on/all_lights_off; for "
            "ambient_mode it is the mode name. If the CMS "
            "can't tell which device you mean, or doesn't recognize a "
            "command for that specific device, it will say so; ask the user "
            "to be more specific or try different wording rather than "
            "guessing or repeating the exact same call."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": "lights_on | lights_off | lights_set | ac_command | lock | unlock | status | good_night | good_morning | ambient_mode | all_lights_on | all_lights_off",
                },
                "target": {
                    "type": "STRING",
                    "description": "The device name exactly as the user said it — never add or change a word or number. For ambient_mode, the mode name as said (pre-entry, entry, meeting, presentation). Not needed for lock/unlock/good_night/good_morning/all_lights_on/all_lights_off.",
                },
                "brightness": {
                    "type": "INTEGER",
                    "description": "0-100, for lights_set.",
                },
                "color": {
                    "type": "STRING",
                    "description": "The colour as said (e.g. blue, warm white, purple) or a hex like #100073, for lights_set. Supported names: warm white, neutral white, red, green, blue, cyan, magenta, yellow, orange, purple.",
                },
                "command": {
                    "type": "STRING",
                    "description": (
                        "The IR codebook verb for ac_command. For the AC specifically, use exactly: "
                        "power_on | power_off | set_temp | set_mode | set_fan. "
                        "For the TV, use one of its real registered buttons (names are case-sensitive): "
                        "Power | Volume Up | Volume Down | mute | Channel Up | Channel Down | OK | Menu | "
                        "Up | Down | Left | Right | source | input | exit | 0-9 (digits). "
                        "Each call is ONE press — for 'turn it up a lot', call it a few times rather than once. "
                        "For any other IR remote, use a short verb matching what the user asked for — the "
                        "CMS knows that device's actual registered button names and will report back if "
                        "yours doesn't match one, so you can ask the user to rephrase instead of retrying "
                        "blindly."
                    ),
                },
                "params": {
                    "type": "OBJECT",
                    "description": "Extra args for ac_command — only the field matching `command`.",
                    "properties": {
                        "temp": {
                            "type": "INTEGER",
                            "description": "Target temperature in Celsius, for command=set_temp.",
                        },
                        "mode": {
                            "type": "STRING",
                            "description": "cool | heat | auto | fan | dry, for command=set_mode.",
                        },
                        "fan": {
                            "type": "STRING",
                            "description": "auto | low | mid | high, for command=set_fan.",
                        },
                        "times": {
                            "type": "INTEGER",
                            "description": (
                                "For Volume Up / Volume Down: how many steps to press. "
                                "1 = a nudge, 3 = a normal 'turn it up/down', "
                                "6 = 'a lot'. Max 10."
                            ),
                        },
                    },
                },
            },
            "required": ["action"],
        },
    },
    {
        "name": "screen_control",
        "description": (
            "Controls what a CMS screen is showing, and its playback, USE "
            "THIS ONLY for an actual display screen — a monitor/TV/kiosk "
            "that shows CMS content: 'push <experience> to tusker 86', 'show "
            "<video> on tusker 27', 'set tusker 86 to idle', 'stop tusker 86', "
            "'pause the video on tusker 27', 'skip forward on tusker 86', "
            "'next item on tusker 27', 'reset the view', 'what's on "
            "<screen>' — where <screen> "
            "and <experience> are whatever names the USER actually said (e.g. "
            "'tusker 86', 'tusker 27'). "
            "NEVER make up a screen or content name: if the user didn't "
            "name a screen, leave 'screen' out entirely (the tool will ask "
            "them, or reuse the one just discussed). 'stop' means the CMS "
            "screen's own Stop button (action:'stop', blanks it to solid "
            "black) — NOT pause; 'reset the view' is the CMS's Reset view "
            "button (action:'reset_view'). play/pause/"
            "seek_forward/seek_back/reset_view only make sense for playable "
            "content (video, or a scrubbable/paged experience) — if the "
            "screen isn't showing anything like that, say so rather than "
            "calling it. next_item/previous_item only work when that screen "
            "has an active playlist queued; the tool will say if it doesn't. "
            "Do NOT use this for a light fixture, the AC, or any other "
            "physical device just because its name is unfamiliar or doesn't "
            "obviously indicate what it is — that's device_control's job, "
            "regardless of the device's name. 'screen' and 'content' are "
            "spoken names exactly as the user said them — the CMS resolves "
            "them to the actual records. If it can't tell which one you "
            "mean, it replies with the real options: offer ONLY those, "
            "never invent one."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": (
                        "assign_experience | assign_media | idle | stop | status | "
                        "play | pause | seek_forward | seek_back | "
                        "next_item | previous_item | reset_view"
                    ),
                },
                "screen": {
                    "type": "STRING",
                    "description": (
                        "The screen name exactly as the user said it. OMIT this "
                        "if the user didn't name one — never guess or make one up."
                    ),
                },
                "content": {
                    "type": "STRING",
                    "description": "Spoken experience or media name — required for assign_experience/assign_media.",
                },
            },
            "required": ["action"],
        },
    },
]
