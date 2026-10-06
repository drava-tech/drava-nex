"""The text-level test cases, grouped by the categories in the benchmark brief.

Expectations are written against what the CMS really exposes (checked in
apps/api/src/services/voice-actions.ts): lights on/off/brightness/colour, AC
power/temperature/mode/fan, TV remote keys (power, volume up/down, mute), the
door, ambient modes, screen content/stop/idle/play/pause/seek/reset, and
status reads for lights, the AC and screens. There is no relative AC step, no
slide/page control, no door-status read and no volume read-back — cases that
ask for those expect an honest "can't", not an invented answer.

kind:
  execute        the expected actions happen (exactly; any_of lists acceptable alternatives)
  partial        `expect` happens and the unresolved rest is asked about (or `completions` happen)
  clarify        nothing is actuated and TRAVIS asks (alt_actions lists acceptable resolutions)
  invalid        nothing is actuated, no out-of-range value is sent, TRAVIS asks or explains
  rejected_ok    the CMS may be asked (TRAVIS can't know the name is wrong) but must refuse honestly
  decline        no CMS calls at all and a short out-of-scope reply
  info           a read call answers it (reply_any names the true value)
  unsupported    no actuation; TRAVIS says it can't instead of inventing an answer
  error          a CMS/LLM fault is injected; TRAVIS must say so and never claim success
  silent         not addressed to TRAVIS: no calls and no spoken response
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .canon import (
    AC, DOOR, L, MODE, SCENE, SCREEN, TV, VOL, Action, all_lights,
)


@dataclass
class Case:
    id: str
    category: str
    utterance: str
    kind: str = "execute"
    expect: list[Action] = field(default_factory=list)
    any_of: list[list[Action]] | None = None
    ordered: bool = False
    # clarify / partial / execute
    alt_actions: list[list[Action]] = field(default_factory=list)
    clarify_ok: bool = False  # for execute: asking instead of acting is also acceptable
    completions: list[list[Action]] = field(default_factory=list)
    reply_any: list[str] = field(default_factory=list)
    reply_none: list[str] = field(default_factory=list)
    # scenario
    setup: str | None = None
    inject: dict | None = None
    turns: list["Case"] | None = None
    age_before: float = 0.0
    transcript: bool = False  # run through _handle_utterance (language + wake double-check)
    llm_down: str | None = None  # "refused" | "hang"
    state: dict[str, object] | None = None  # mock state that must hold afterwards
    failed_calls_ok: bool = False
    tags: list[str] = field(default_factory=list)
    note: str = ""


def _ex(cid, cat, text, expect, **kw) -> Case:
    return Case(cid, cat, text, "execute", expect=expect if isinstance(expect, list) else [expect], **kw)


# ═══ K. confused, hesitant and confusing speech ═══════════════════════════
def confusing() -> list[Case]:
    """People hesitate, correct themselves, ramble, contradict themselves, mention a feeling
    instead of a command, or put the words in the wrong order. TRAVIS has to find the one
    thing they mean, or ask: never act on a guess."""
    c: list[Case] = []

    def add(cid, text, kind="execute", expect=None, **kw):
        c.append(Case(f"conf.{cid}", "confusing", text, kind, expect=expect or [], **kw))

    # hesitation and padding
    add("um_ac_on", "Um, uh, can you, like, turn on the AC please.", expect=[AC("on")])
    add("uh_ac_24", "So, uh, set the AC to, uh, twenty four.", expect=[AC("temp", 24)])
    add("maybe_l1", "Well, I think maybe turn on tusker L1, if you can.", expect=[L("on", "tusker L1")])
    add("polite_edge", "Could you maybe, if it's not too much trouble, switch on tusker edge for me?", expect=[L("on", "tusker edge")])
    add("wondering_lock", "I was wondering whether you could possibly lock up the door.", expect=[DOOR("lock")])
    add("what_call_it", "Turn the, what do you call it, tusker L1 on.", expect=[L("on", "tusker L1")])
    add("basically_ac", "Okay so basically what I want is for you to turn on the AC.", expect=[AC("on")])
    add("thanks_then", "Thanks Travis, now turn off tusker edge.", expect=[L("off", "tusker edge")])
    add("uh_edge_off", "Turn off, uh, the edge light.", expect=[L("off", "tusker edge")])
    add("edge_off_please", "Edge light, off, please.", expect=[L("off", "tusker edge")])
    add("ac_put_22", "Can you put the AC on twenty-two please?", expect=[AC("temp", 22)])
    # self-corrections: the last version wins
    add("fix_l1_l2", "Turn on tusker L1, no wait, tusker L2.", expect=[L("on", "tusker L2")])
    add("fix_24_22", "Set the AC to 24, actually make it 22.", expect=[AC("temp", 22)])
    add("fix_lock", "Lock the door, sorry, I mean unlock the door.", expect=[DOOR("unlock")])
    add("fix_value_only", "Set the AC to 24, no wait, 22.", expect=[AC("temp", 22)])
    add("fix_edge", "Switch the lights off, or actually just tusker edge.", expect=[L("off", "tusker edge")])
    add("fix_whole", "Turn on tusker L1, no wait, turn off tusker L2.", expect=[L("off", "tusker L2")])
    # words in the wrong order
    add("name_first", "Tusker edge, turn it on.", expect=[L("on", "tusker edge")])
    add("ac_first", "AC, set it to 22 degrees.", expect=[AC("temp", 22)])
    # a feeling, not a command: ask what they'd like, change nothing
    add("too_dark", "It's too dark in here.", "clarify")
    add("freezing", "It's freezing in here.", "clarify")
    add("cant_hear", "I can't hear anything.", "clarify")
    # contradictions and nonsense: ask, change nothing
    add("on_and_off", "Turn the lights on and off.", "clarify")
    add("two_temps", "Set the AC to 20 and 28.", "clarify")
    add("ac_blue", "Make the AC blue.", "clarify")
    add("edge_degrees", "Set tusker edge to 24 degrees.", "clarify")
    add("ac_percent", "Set the AC to 50 percent.", "clarify")
    add("just_lights", "The lights.", "clarify")
    add("just_ac", "The AC.", "clarify")
    # cancelled
    add("never_mind", "Um, never mind.", "noop")
    add("forget_it", "Forget it, I'll do it later.", "noop")
    # a request taken back after it was said, in many wordings: nothing runs
    add("take_back_stop", "Turn on tusker edge, stop.", "noop")
    add("take_back_oh_no", "Turn off tusker edge, oh no.", "noop")
    add("take_back_never_mind", "Turn on tusker edge. Never mind.", "noop")
    add("take_back_hold_on", "Turn off the AC, hold on, hold on.", "noop")
    add("take_back_dont", "Set the AC to 22, actually don't.", "noop")
    add("take_back_second_thought", "Turn on tusker L1, on second thought, leave it.", "noop")
    add("take_back_not_that", "Switch off tusker L2, not that.", "noop")
    add("take_back_wait", "Lock the door, wait, wait, wait.", "noop")
    # taken back in part: the rest still runs
    add("part_back", "Turn on tusker L1 and tusker L2, no, just tusker L1.", expect=[L("on", "tusker L1")])
    # a spelled-out chain
    add("l1_what_was_it", "Switch on tusker L1 and, uh, what was it, tusker L2.",
        any_of=[[L("on", "tusker L1"), L("on", "tusker L2")], [L("on", "tusker L3")]])
    return c


# ═══ A. basic device commands ═════════════════════════════════════════════
def basic() -> list[Case]:
    c: list[Case] = []
    add = lambda cid, t, e, **kw: c.append(_ex(f"basic.{cid}", "basic", t, e, **kw))  # noqa: E731
    add("ac_on", "turn on the AC", AC("on"))
    add("ac_off", "turn off the AC", AC("off"))
    for n in (24, 18, 30):
        add(f"ac_temp_{n}", f"set the AC to {n} degrees", AC("temp", n))
    for m in ("cool", "heat", "auto", "fan", "dry"):
        add(f"ac_mode_{m}", f"set the AC to {m} mode", AC("mode", m))
    add("ac_fan_high", "set the AC fan to high", AC("fan", "high"))
    add("ac_fan_low", "set the AC fan speed to low", AC("fan", "low"))
    add("edge_on", "turn on tusker edge", L("on", "tusker edge"))
    add("l1_off", "turn off tusker L1", L("off", "tusker L1"))
    add("l2_on", "turn on tusker L2", L("on", "tusker L2"))
    add("l3_on", "turn on tusker L3", L("on", "tusker L3"))
    c.append(Case("basic.all_on", "basic", "turn on all the lights", "execute", any_of=all_lights("on")))
    c.append(Case("basic.all_off", "basic", "turn off all the lights", "execute", any_of=all_lights("off")))
    add("edge_50", "set tusker edge to 50 percent", L("brightness", "tusker edge", 50))
    add("l1_30", "dim tusker L1 to 30 percent", L("brightness", "tusker L1", 30))
    add("l3_80", "set tusker L3 to 80 percent", L("brightness", "tusker L3", 80))
    add("edge_0", "set tusker edge to zero percent", L("brightness", "tusker edge", 0), tags=["boundary"])
    add("edge_100", "set tusker edge to one hundred percent", L("brightness", "tusker edge", 100), tags=["boundary"])
    add("edge_blue", "make tusker edge blue", L("color", "tusker edge", "blue"))
    add("l1_red", "set tusker L1 to red", L("color", "tusker L1", "red"))
    add("l2_warm", "make tusker L2 warm white", L("color", "tusker L2", "warm white"))
    add("l3_purple", "make tusker L3 purple", L("color", "tusker L3", "purple"))
    add("tv_power", "turn on the TV", TV("power"), note="IR power is a toggle; the CMS has no TV power state")
    add("vol_up", "volume up", VOL("vol_up"))
    add("vol_down", "turn the volume down", VOL("vol_down"))
    add("vol_up_5", "turn the volume up by five", VOL("vol_up", 5))
    add("mute", "mute", VOL("mute"))
    add("lock", "lock the door", DOOR("lock"))
    add("unlock", "unlock the door", DOOR("unlock"))
    add("stop_86", "stop tusker 86", SCREEN("stop", "tusker 86"))
    add("idle_27", "set tusker 27 to idle", SCREEN("idle", "tusker 27"))
    add("pause_86", "pause tusker 86", SCREEN("pause", "tusker 86"))
    add("play_27", "play tusker 27", SCREEN("play", "tusker 27"))
    add("reset_view", "reset the view on tusker 86", SCREEN("reset_view", "tusker 86"))
    add("seek_fwd", "skip forward on tusker 86", SCREEN("seek_forward", "tusker 86"))
    add("seek_back", "skip back on tusker 27", SCREEN("seek_back", "tusker 27"))
    add("push_media", "show the company presentation on tusker 86",
        SCREEN("assign_media", "tusker 86", "Company Presentation"), state={"screens.main-screen.mediaName": "Company Presentation"})
    add("push_exp", "push the flight simulation experience to tusker 27",
        SCREEN("assign_experience", "tusker 27", "Flight Simulation"), state={"screens.kiosk.experienceName": "Flight Simulation"})
    for key, label in (("pre-entry", "Pre-entry"), ("entry", "Entry"), ("meeting", "Meeting"), ("presentation", "Presentation")):
        add(f"mode_{key}", f"{key} mode", MODE(label))
    add("hi", "hi", SCENE("good_morning"))
    add("bye", "bye", SCENE("good_night"))
    return c


# ═══ B. natural-language variations of the same intent ════════════════════
def variations() -> list[Case]:
    c: list[Case] = []

    def group(name: str, expect: list[Action], phrasings: list[str], **kw):
        for i, t in enumerate(phrasings, 1):
            c.append(Case(f"var.{name}.{i}", "variations", t, "execute", expect=expect, **kw))

    group("ac_temp_24", [AC("temp", 24)], [
        "Set the AC to 24.", "Set the temperature to 24.", "Make the AC 24 degrees.",
        "Can you set the room temperature to 24?", "I want the AC at 24.",
        "Bring the temperature down to 24.", "Could you make it 24 degrees?",
    ])
    group("ac_on", [AC("on")], [
        "Turn on the AC.", "Switch the air conditioner on.", "AC on please.", "Can you start the AC?",
        "I'd like the AC on.", "Get the air conditioning running.", "Power up the AC.",
    ])
    group("ac_off", [AC("off")], [
        "Turn the AC off.", "Switch off the air conditioning.", "Shut off the AC.", "AC off.",
        "Could you stop the AC?", "Kill the AC.", "I want the AC off.",
    ])
    group("light_on", [L("on", "tusker edge")], [
        "Turn on tusker edge.", "Switch on the tusker edge light.", "Tusker edge on.", "Can you put tusker edge on?",
        "Light up tusker edge.", "I'd like tusker edge on.", "Get tusker edge on please.",
    ])
    group("light_off", [L("off", "tusker L1")], [
        "Turn off tusker L1.", "Switch tusker L1 off.", "Tusker L1 off.", "Can you shut off tusker L1?",
        "Kill tusker L1.", "I want tusker L1 off.", "Please turn tusker L1 off.",
    ])
    group("brightness_80", [L("brightness", "tusker edge", 80)], [
        "Set tusker edge to 80 percent.", "Make tusker edge 80 percent bright.", "Tusker edge brightness 80.",
        "Dim tusker edge to 80.", "Can you put tusker edge at 80 percent?", "I want tusker edge at 80 percent.",
        "Set the brightness of tusker edge to eighty.",
    ])
    group("colour_blue", [L("color", "tusker L1", "blue")], [
        "Make tusker L1 blue.", "Change tusker L1 to blue.", "Set tusker L1 colour to blue.", "Tusker L1 blue please.",
        "Can you turn tusker L1 blue?", "I want tusker L1 blue.", "Switch tusker L1 to a blue colour.",
    ])
    group("volume_up", [VOL("vol_up")], [
        "Volume up.", "Turn it up.", "Louder please.", "Increase the volume.", "Make it louder.",
        "Raise the sound.", "Turn up the volume.",
    ])
    group("unlock", [DOOR("unlock")], [
        "Unlock the door.", "Open the front door.", "Can you unlock the door?", "Let me in.",
        "Please unlock the front door.", "I need the door unlocked.", "Release the door lock.",
    ])
    group("lock", [DOOR("lock")], [
        "Lock the door.", "Lock up.", "Can you lock the front door?", "Secure the door.",
        "Close and lock the door.", "Please lock the door.", "I want the door locked.",
    ])
    group("stop_screen", [SCREEN("stop", "tusker 86")], [
        "Stop tusker 86.", "Blank tusker 86.", "Black out tusker 86.", "Can you stop tusker 86?",
        "Please stop tusker 86.", "Tusker 86 stop.", "I want tusker 86 stopped.",
    ])
    group("push_content", [SCREEN("assign_media", "tusker 86", "Company Presentation")], [
        "Show the company presentation on tusker 86.", "Put the company presentation on tusker 86.",
        "Display the company presentation on tusker 86.", "Can you open the company presentation on tusker 86?",
        "Play the company presentation on tusker 86.", "Send the company presentation to tusker 86.",
        "I want to see the company presentation on tusker 86.",
    ], state={"screens.main-screen.mediaName": "Company Presentation"}, failed_calls_ok=True,
        note="the model can't tell media from experiences; a retry after the CMS offers the real list is fine")
    group("meeting_mode", [MODE("Meeting")], [
        "Meeting mode.", "Switch to meeting mode.", "Set the lights to meeting mode.", "Activate meeting mode.",
        "Put the room in meeting mode.", "I want meeting mode.", "Can you turn on meeting mode?",
    ])
    return c


# ═══ C. several actions in one utterance ══════════════════════════════════
def multi_action() -> list[Case]:
    c: list[Case] = []

    def add(cid, text, expect=None, any_of=None, ordered=False, **kw):
        c.append(Case(f"multi.{cid}", "multi_action", text, "execute", expect=expect or [], any_of=any_of, ordered=ordered, **kw))

    add("ac_edge", "Set the AC to 24 and turn on tusker edge.", [AC("temp", 24), L("on", "tusker edge")])
    add("l1_l2", "Turn on tusker L1 and tusker L2.", any_of=[[L("on", "tusker L1"), L("on", "tusker L2")], [L("on", "tusker L3")]])
    add("ac_edge_lock", "Set the AC to 23, turn off tusker edge, and lock the door.",
        [AC("temp", 23), L("off", "tusker edge"), DOOR("lock")])
    add("edge70_tv", "Set tusker edge to 70 percent and turn on the TV.", [L("brightness", "tusker edge", 70), TV("power")])
    add("ac24_edge80", "Set the AC to 24 and set tusker edge to 80 percent.", [AC("temp", 24), L("brightness", "tusker edge", 80)])
    add("edge_ac_unlock", "Turn off tusker edge, set the AC to 22 and unlock the door.",
        [L("off", "tusker edge"), AC("temp", 22), DOOR("unlock")])
    add("ac_on_25", "Turn on the AC and set it to 25.", any_of=[[AC("on"), AC("temp", 25)], [AC("temp", 25)]])
    add("two_colours", "Make tusker edge blue and tusker L1 red.", [L("color", "tusker edge", "blue"), L("color", "tusker L1", "red")])
    add("vol_mute", "Turn the volume up by three and then mute.", [VOL("vol_up", 3), VOL("mute")], ordered=True)
    add("lock_all_off", "Lock the door and turn off all the lights.",
        any_of=[[DOOR("lock"), L("off", "all")], [DOOR("lock"), L("off", "tusker edge"), L("off", "tusker L1"), L("off", "tusker L2")]])
    add("tv_present", "Turn on the TV and show the company presentation on tusker 86.",
        [TV("power"), SCREEN("assign_media", "tusker 86", "Company Presentation")], ordered=True,
        state={"screens.main-screen.mediaName": "Company Presentation"}, failed_calls_ok=True)
    add("two_screens", "Show the flight simulation on tusker 27 and the company presentation on tusker 86.",
        [SCREEN("assign_experience", "tusker 27", "Flight Simulation"), SCREEN("assign_media", "tusker 86", "Company Presentation")],
        failed_calls_ok=True)
    add("push_ac", "Push the welcome video to tusker 86 and set the AC to 22.",
        [SCREEN("assign_media", "tusker 86", "Welcome Video"), AC("temp", 22)], failed_calls_ok=True)
    add("heat_21", "Set the AC to heat mode at 21 degrees.", [AC("mode", "heat"), AC("temp", 21)])
    add("l3_dim_warm", "Dim tusker L3 to 40 percent and make it warm white.",
        [L("brightness", "tusker L3", 40), L("color", "tusker L3", "warm white")])
    add("three_off", "Turn off tusker L1, tusker L2 and tusker edge.",
        any_of=[[L("off", "tusker L1"), L("off", "tusker L2"), L("off", "tusker edge")], [L("off", "tusker L3"), L("off", "tusker edge")]])
    add("four_actions", "Set the AC to 24, turn on tusker L1, make tusker edge purple and unlock the door.",
        [AC("temp", 24), L("on", "tusker L1"), L("color", "tusker edge", "purple"), DOOR("unlock")])
    add("two_screen_ops", "Stop tusker 86 and pause tusker 27.", [SCREEN("stop", "tusker 86"), SCREEN("pause", "tusker 27")])
    add("mode_ac", "Meeting mode and set the AC to 23.", [MODE("Meeting"), AC("temp", 23)])
    add("ac_lights_all", "Set the AC to 24 and turn the lights on.",
        any_of=[[AC("temp", 24), L("on", "all")], [AC("temp", 24), L("on", "tusker edge"), L("on", "tusker L1"), L("on", "tusker L2")]],
        note="literal example from the brief; 'the lights' = all lights")
    add("good_morning_ac", "Turn off tusker edge and set the AC to 20 degrees.", [L("off", "tusker edge"), AC("temp", 20)])
    add("ac_mode_fan", "Set the AC to cool mode, fan high.", [AC("mode", "cool"), AC("fan", "high")])
    add("door_vol", "Unlock the door and turn the volume down by two.", [DOOR("unlock"), VOL("vol_down", 2)])
    add("edge_colours", "Turn on tusker edge and make it green.", [L("on", "tusker edge"), L("color", "tusker edge", "green")],
        any_of=[[L("on", "tusker edge"), L("color", "tusker edge", "green")], [L("color", "tusker edge", "green")]])
    add("idle_both", "Set tusker 86 to idle and tusker 27 to idle.", [SCREEN("idle", "tusker 86"), SCREEN("idle", "tusker 27")])
    add("ac_lights_off", "Set the AC to 22 and turn the lights off.",
        any_of=[[AC("temp", 22), L("off", "all")], [AC("temp", 22), L("off", "tusker edge"), L("off", "tusker L1"), L("off", "tusker L2")]],
        tags=["fast_path_swallow"])
    add("unlock_lights_on", "Unlock the door and turn the lights on.",
        any_of=[[DOOR("unlock"), L("on", "all")], [DOOR("unlock"), L("on", "tusker edge"), L("on", "tusker L1"), L("on", "tusker L2")]],
        tags=["fast_path_swallow"])
    add("lock_edge_on", "Lock the door and tusker edge light on.", [DOOR("lock"), L("on", "tusker edge")], tags=["fast_path_swallow"])
    add("ac_off_lights_off", "Turn off the AC and all the lights.",
        any_of=[[AC("off"), L("off", "all")], [AC("off"), L("off", "tusker edge"), L("off", "tusker L1"), L("off", "tusker L2")]])

    # one failing part must not stop the unrelated parts
    add("fail_l9_ac", "Turn on tusker L9 and set the AC to 24.", [AC("temp", 24)], failed_calls_ok=True,
        reply_any=["l9", "couldn't", "can't", "which", "find"], note="tusker L9 doesn't exist; the AC must still be set")
    add("fail_unlock_l9", "Unlock the door and turn on tusker L9.", [DOOR("unlock")], failed_calls_ok=True,
        reply_any=["l9", "couldn't", "can't", "which", "find"])

    # literal examples from the brief with an unresolved part: do what's clear, ask about the rest
    c.append(Case("multi.literal_brightness", "multi_action", "Set the AC to 24 and increase the brightness to 80.", "partial",
                  expect=[AC("temp", 24)], completions=[[L("brightness", t, 80) for t in ("tusker edge", "tusker L1", "tusker L2")]],
                  note="brightness names no light"))
    c.append(Case("multi.literal_lights70_display", "multi_action", "Turn the lights to 70 percent and switch on the display.", "partial",
                  expect=[], completions=[[L("brightness", t, 70) for t in ("tusker edge", "tusker L1", "tusker L2")] + [TV("power")]],
                  note="'the lights' at 70 names no light; 'the display' is a screen or the TV"))
    c.append(Case("multi.literal_ac_off_present", "multi_action", "Set the AC to 23, turn the lights off, and show the presentation.", "partial",
                  any_of=[[AC("temp", 23), L("off", "all")], [AC("temp", 23), L("off", "tusker edge"), L("off", "tusker L1"), L("off", "tusker L2")]],
                  completions=[],
                  note="presentation names no screen: AC + lights should happen, then ask which screen"))
    c.append(Case("multi.literal_temp_brightness", "multi_action", "Set the temperature to 24 and brightness to 80.", "partial",
                  expect=[AC("temp", 24)], completions=[[L("brightness", t, 80) for t in ("tusker edge", "tusker L1", "tusker L2")]]))
    c.append(Case("multi.literal_display_present", "multi_action", "Turn on the display and open the required presentation.", "clarify",
                  note="no screen and no presentation name"))
    return c


# ═══ D. ambiguous commands (no context) ═══════════════════════════════════
def ambiguous() -> list[Case]:
    c: list[Case] = []

    def add(cid, text, **kw):
        c.append(Case(f"amb.{cid}", "ambiguous", text, "clarify", **kw))

    add("turn_it_on", "Turn it on.")
    add("brighter", "Make it brighter.")
    add("set_24", "Set it to 24.")
    add("temp_up", "Increase the temperature.", alt_actions=[[AC("temp", "*")]],
        note="no relative AC step exists; reading the temperature then setting a new one is acceptable")
    add("turn_that_off", "Turn that off.")
    add("room_brighter", "Make the room brighter.")
    add("warmer", "Make it warmer in here.", alt_actions=[[AC("temp", "*")]])
    add("switch_off", "Switch it off.")
    add("open_it", "Open it.", note="the door? a screen? ambiguous")
    add("dim_bit", "Dim it a bit.")
    add("change_colour", "Change the colour.")
    add("play_it", "Play it.")
    return c


# ═══ E. invalid or incomplete commands ════════════════════════════════════
def invalid() -> list[Case]:
    c: list[Case] = []

    def add(cid, text, kind="invalid", **kw):
        c.append(Case(f"inv.{cid}", "invalid", text, kind, **kw))

    add("set_ac", "Set the AC.")
    add("turn_on", "Turn on.")
    add("increase", "Increase.")
    add("set_it_to", "Set it to.")
    add("make_it_100", "Make it 100.")
    add("banana", "Set temperature to banana.")
    add("500_percent", "Turn the lights to 500 percent.")
    add("ac_5", "Set the AC to 5 degrees.")
    add("ac_200", "Set the AC to 200 degrees.")
    add("ac_15", "Set the AC to 15 degrees.", tags=["boundary"])
    add("ac_31", "Set the AC to 31 degrees.", tags=["boundary"])
    add("edge_150", "Set tusker edge to 150 percent.")
    add("edge_minus", "Set tusker edge to minus ten percent.")
    add("vol_50", "Turn the volume up by fifty.", note="the TV remote takes 1-10 presses")
    add("colour_infrared", "Make tusker edge infrared.", "rejected_ok", note="not a colour the lights have; the CMS lists the real ones")
    add("mode_turbo", "Set the AC to turbo mode.", "rejected_ok")
    add("fan_hurricane", "Set the AC fan to hurricane.", "rejected_ok")
    add("unknown_light", "Turn on tusker L9.", "rejected_ok", note="a name that doesn't exist must not be swapped for another")
    add("unknown_screen", "Stop the lobby screen.", "rejected_ok")
    add("unknown_content", "Show the quarterly report on tusker 86.", "rejected_ok")
    add("unknown_mode", "Set holiday mode.", "rejected_ok")
    return c


# ═══ F. unrelated / general questions: the domain gate ════════════════════
def domain() -> list[Case]:
    c: list[Case] = []

    def add(cid, text, **kw):
        c.append(Case(f"dom.{cid}", "domain_reject", text, "decline", **kw))

    for cid, text in [
        ("capital", "What's the capital of India?"), ("cricket", "Who won yesterday's cricket match?"),
        ("python", "Write a Python program."), ("weather", "What's the weather today?"), ("joke", "Tell me a joke."),
        ("quantum", "What is quantum computing?"), ("musk", "Who is Elon Musk?"),
        ("ceo", "Who is the CEO of Google?"), ("movie", "Recommend a good movie."), ("translate", "Translate hello into French."),
        ("percent", "What's fifteen percent of two hundred forty?"), ("sky", "What colour is the sky?"),
        ("favourite", "What's your favourite colour?"), ("music_taste", "Do you like music?"),
        ("diwali", "How many days until Diwali?"), ("poem", "Write me a poem about the sea."),
        ("history", "Tell me about the history of India."), ("recipe", "Give me a recipe for pasta."),
        ("math", "What is seven times eight?"), ("stocks", "How are the stock markets doing?"),
    ]:
        add(cid, text)
    # keywords alone must not make something relevant
    for cid, text in [
        ("ac_brand", "What is the best AC brand in India?"), ("car_door", "How do I lock a car door?"),
        ("sphere", "What's the volume of a sphere with radius three?"), ("lighting_history", "Tell me about the history of lighting design."),
        ("which_tv", "Which TV should I buy for my living room?"), ("how_ac_works", "Explain how air conditioners work."),
        ("tv_show", "Is the TV show Friends any good?"), ("screen_time", "Is too much screen time bad for children?"),
        ("play_music", "Play some music."), ("light_speed", "How fast does light travel?"),
        ("door_dash", "What is DoorDash?"), ("mode_stat", "What is the mode of three, five and five?"),
    ]:
        add(cid, text, tags=["keyword_trap"])
    return c


def domain_mixed() -> list[Case]:
    """In-scope plus out-of-scope in one breath: do the first, decline the rest, never answer the rest."""
    c: list[Case] = []

    def add(cid, text, expect, none):
        c.append(Case(f"mix.{cid}", "domain_mixed", text, "execute", expect=expect, reply_none=none, tags=["mixed_scope"]))

    add("door_joke", "Unlock the door and tell me a joke.", [DOOR("unlock")], ["why did", "knock"])
    add("edge_capital", "Turn on tusker edge and what's the capital of France?", [L("on", "tusker edge")], ["paris"])
    add("ac_match", "Set the AC to 24 and who won the match yesterday?", [AC("temp", 24)], ["won by", "beat"])
    add("lock_poem", "Lock the door and write me a poem about the sea.", [DOOR("lock")], ["roses", "waves"])
    add("math_l1", "What's two plus two and turn off tusker L1?", [L("off", "tusker L1")], ["four", " 4"])
    return c


# ═══ G. relevant questions about the room ═════════════════════════════════
def relevant_info() -> list[Case]:
    c: list[Case] = []
    add = lambda cid, text, kind="info", **kw: c.append(Case(f"info.{cid}", "relevant_info", text, kind, **kw))  # noqa: E731
    add("main_screen", "What's currently playing on the main screen?", setup="main_welcome", reply_any=["welcome"])
    add("tusker86", "What's showing on tusker 86?", setup="main_welcome", reply_any=["welcome"])
    add("which_presentation", "What presentation is open?", setup="main_presentation", reply_any=["company presentation", "which screen", "list the screens", "name of the screen"],
        note="no screen named: reading the screens or asking which one are both fine")
    add("which_screen", "Which screen is showing this?", "unsupported", note="'this' is unresolvable; ask or say so")
    add("devices", "What devices are available in this room?", reply_any=["tusker edge", "tusker l1"])
    add("screens", "What screens do you have?", reply_any=["tusker 86", "tusker 27"])
    add("ac_temp", "What is the AC temperature?", setup="ac_23", reply_any=["23"])
    add("ac_on", "Is the AC on?", setup="ac_23", reply_any=["on"])
    add("edge_on", "Is tusker edge on?", setup="edge_60", reply_any=["on"])
    add("edge_level", "What brightness is tusker edge at?", setup="edge_60", reply_any=["60"])
    add("display_on", "Is the display on?", setup="main_welcome", reply_any=["showing", "welcome", "on", "can't", "which"],
        note="a screen read, or an honest 'which display / can't tell'")
    add("slide", "What slide are we currently on?", "unsupported", reply_none=["slide 1", "slide 2", "slide 3", "slide one", "slide two", "slide number"],
        note="the CMS exposes no slide position")
    add("volume_level", "What's the volume level?", "unsupported", reply_none=["percent", "%"], note="the TV remote is one-way")
    add("door_state", "Is the door locked?", "unsupported", note="no door-status read exists")
    add("hours", "What are your opening hours?", "unsupported", reply_none=["9", "10", "5 pm", "6 pm"], note="no knowledge base content: must not invent hours")
    add("what_is_this", "What is this experience center?", "unsupported", note="must not invent facts about the company")
    add("company", "Tell me about the company.", "unsupported")
    add("what_can_you_do", "What can you do?", "info_free", reply_any=["light", "screen", "ac", "door"])
    return c


# ═══ H. context across turns ══════════════════════════════════════════════
def context() -> list[Case]:
    def turn(sid, n, text, expect=None, kind="execute", **kw) -> Case:
        return Case(f"ctx.{sid}.{n}", "context", text, kind, expect=expect or [], **kw)

    scenarios = [
        Case("ctx.ac", "context", "Set the AC to 24, then make it 22, then turn it off", "scenario", turns=[
            turn("ac", 1, "Set the AC to 24.", [AC("temp", 24)]),
            turn("ac", 2, "Make it 22.", [AC("temp", 22)]),
            turn("ac", 3, "Turn it off.", [AC("off")], clarify_ok=True),
        ]),
        Case("ctx.edge", "context", "tusker edge on, then 80 percent, then off", "scenario", turns=[
            turn("edge", 1, "Turn on tusker edge.", [L("on", "tusker edge")]),
            turn("edge", 2, "Make it 80 percent.", [L("brightness", "tusker edge", 80)]),
            turn("edge", 3, "Turn it off.", [L("off", "tusker edge")]),
        ]),
        Case("ctx.all_lights", "context", "lights on, then them at 80, then off", "scenario", turns=[
            Case("ctx.all_lights.1", "context", "Turn the lights on.", "execute", any_of=all_lights("on")),
            Case("ctx.all_lights.2", "context", "Make them 80 percent.", "execute",
                 any_of=[[L("brightness", t, 80) for t in ("tusker edge", "tusker L1", "tusker L2")]], clarify_ok=True),
            Case("ctx.all_lights.3", "context", "Turn them off.", "execute", any_of=all_lights("off"), clarify_ok=True),
        ]),
        Case("ctx.after_chat", "context", "an unrelated question in the middle", "scenario", turns=[
            turn("after_chat", 1, "Set tusker edge to 50 percent.", [L("brightness", "tusker edge", 50)]),
            Case("ctx.after_chat.2", "context", "What's the capital of France?", "decline"),
            turn("after_chat", 3, "Make it 80 percent.", [L("brightness", "tusker edge", 80)], clarify_ok=True),
        ]),
        Case("ctx.switch", "context", "the most recent device wins", "scenario", turns=[
            turn("switch", 1, "Set the AC to 24.", [AC("temp", 24)]),
            turn("switch", 2, "Turn on tusker edge.", [L("on", "tusker edge")]),
            turn("switch", 3, "Make it 80 percent.", [L("brightness", "tusker edge", 80)]),
        ]),
        Case("ctx.stale", "context", "a pronoun ten minutes later", "scenario", turns=[
            turn("stale", 1, "Turn on tusker edge.", [L("on", "tusker edge")]),
            Case("ctx.stale.2", "context", "Turn it off.", "clarify", age_before=900, tags=["design"],
                 note="15 minutes later 'it' is stale: asking is safer than acting on an old target"),
        ]),
        Case("ctx.screen", "context", "screen follow-ups", "scenario", turns=[
            turn("screen", 1, "Show the company presentation on tusker 86.", [SCREEN("assign_media", "tusker 86", "Company Presentation")],
                 failed_calls_ok=True),
            turn("screen", 2, "Pause it.", [SCREEN("pause", "tusker 86")], clarify_ok=True),
            turn("screen", 3, "Stop it.", [SCREEN("stop", "tusker 86")], clarify_ok=True),
        ]),
        Case("ctx.no_context_carry", "context", "a fresh 'it' with nothing before it", "scenario", turns=[
            Case("ctx.no_context_carry.1", "context", "Turn it on.", "clarify"),
        ]),
    ]
    return scenarios


# ═══ I. faults: the CMS, the network, the LLM ═════════════════════════════
def errors() -> list[Case]:
    c: list[Case] = []
    commands = [
        ("fast_light", "Turn on tusker edge.", "fast path"),
        ("fast_ac", "Set the AC to 24 degrees.", "fast path"),
        ("fast_door", "Unlock the door.", "fast path, safety-critical"),
    ]
    faults = [
        ("timeout", {"mode": "timeout"}), ("http400", {"mode": "http400"}), ("http401", {"mode": "http401"}),
        ("http403", {"mode": "http403"}), ("http500", {"mode": "http500"}),
        ("device_unavailable", {"mode": "device_unavailable"}), ("network_down", {"mode": "down"}),
    ]
    for cid, text, note in commands:
        for fid, fault in faults:
            c.append(Case(f"err.{cid}.{fid}", "errors", text, "error", inject=fault, note=note))
    for cid, text in [("llm_lights_ac", "Turn off all the lights and set the AC to 22."),
                      ("llm_push", "Show the company presentation on tusker 86.")]:
        for fid, fault in [("timeout", {"mode": "timeout"}), ("http500", {"mode": "http500"}), ("network_down", {"mode": "down"})]:
            c.append(Case(f"err.{cid}.{fid}", "errors", text, "error", inject=fault, note="LLM path"))
    # the language model itself
    c.append(Case("err.llm_down.fast_still_works", "errors", "Turn on tusker edge.", "execute", expect=[L("on", "tusker edge")],
                  llm_down="refused", note="the command list must not depend on the LLM"))
    c.append(Case("err.llm_down.multi_still_works", "errors", "Turn off all the lights and set the AC to 22.", "execute",
                  any_of=[[AC("temp", 22), L("off", "all")]], llm_down="refused", note="a multi-action list command doesn't need the model"))
    c.append(Case("err.llm_down.llm_path", "errors", "Make the place feel welcoming please.", "error", llm_down="refused"))
    c.append(Case("err.llm_down.offtopic", "errors", "What's the capital of France?", "error", llm_down="refused"))
    c.append(Case("err.llm_hang.llm_path", "errors", "Make the place feel welcoming please.", "error", llm_down="hang"))
    return c


# ═══ J. wake word and meeting speech, at transcript level ═════════════════
def wake() -> list[Case]:
    c: list[Case] = []

    def add(cid, text, kind, **kw):
        c.append(Case(f"wake.{cid}", "wake", text, kind, transcript=True, **kw))

    add("addressed", "Hey Travis, turn on the lights.", "execute", any_of=all_lights("on"))
    add("hey_comma", "Hey, Travis, turn on the lights.", "execute", any_of=all_lights("on"))
    add("can_you", "Hey Travis can you set the AC to 24?", "execute", expect=[AC("temp", 24)])
    add("okay_brightness", "Hey Travis, increase the brightness.", "clarify", note="no light and no level named")
    add("trailing", "Turn off tusker edge, hey Travis.", "execute", expect=[L("off", "tusker edge")])
    add("explicit_80", "Hey Travis, set tusker edge to 80 percent.", "execute", expect=[L("brightness", "tusker edge", 80)])
    add("brief_80", "Hey Travis, increase the brightness to 80 percent.", "partial", completions=[[L("brightness", t, 80) for t in ("tusker edge", "tusker L1", "tusker L2")]],
        note="the literal example from the brief: no light is named, so asking which is correct")
    for cid, text in [
        ("mention_1", "Shrutha was talking to Travis yesterday."), ("mention_2", "The Travis system is working well."),
        ("mention_3", "I told Travis to wait outside."), ("mention_4", "We named the project Travis last year."),
        ("mention_5", "Did you ask Travis about the lights?"), ("mention_6", "Travis was saying we should increase the brightness."),
    ]:
        add(cid, text, "silent", tags=["mention"])
    for cid, text in [
        ("meet_1", "We should increase the brightness for the presentation."), ("meet_2", "Can someone turn the AC down?"),
        ("meet_3", "The lights should probably be around 80 percent."), ("meet_4", "Let's switch the display on."),
        ("meet_5", "I think the room is too cold, someone lower the AC to twenty two."), ("meet_6", "Could we lock the door before we start?"),
        ("meet_7", "Turn off the lights, we're going to watch the video."), ("meet_8", "Okay let's go to the next slide."),
        ("meet_9", "Set the AC to 24 and turn on tusker edge."), ("meet_10", "Unlock the door, the visitors are here."),
    ]:
        add(cid, text, "silent", tags=["meeting"])
    for cid, text in [("hindi", "ट्रैविस लाइट ऑन करो"), ("telugu", "ట్రావిస్ లైట్ ఆన్ చేయి")]:
        add(cid, text, "silent", tags=["non_english"])
    return c


def all_cases() -> list[Case]:
    return basic() + variations() + multi_action() + ambiguous() + invalid() + domain() + domain_mixed() + confusing() + relevant_info() + context() + errors() + wake()


def flatten(cases: list[Case]) -> list[Case]:
    out: list[Case] = []
    for c in cases:
        out.extend(c.turns) if c.turns else out.append(c)
    return out
