/**
 * Master switch for the push-up content transition on the TV display.
 *
 * The transition keeps the outgoing content mounted for the length of the
 * slide, so for ~1.5s a video→video push has two <video> elements in the tree.
 * The outgoing one is paused the moment it goes outgoing (VideoRenderer's
 * `outgoing` effect), which releases the hardware decoder and leaves only a
 * static last frame — enough for every PC-class screen. A signage appliance
 * with a single fixed-function decoder (the BrightSign XT1145) is the case this
 * switch exists for: its display URL is configured once at the device, so
 * appending `?pushTransition=0` opts that one screen out with no deploy.
 *
 * Disabled means today's behaviour exactly: a hard cut, no outgoing layer, and
 * `staged`/`outgoing` false everywhere so no renderer defers anything.
 */
export const PUSH_TRANSITION_ENABLED = true;

/** Query param that overrides the constant above for a single screen. */
const OPT_OUT_PARAM = "pushTransition";

/**
 * Read once per mount, not reactively — whether this panel animates is a
 * property of the installation, and re-deciding it mid-session would strand a
 * push halfway through.
 *
 * @param preview True for a CMS-side mirror of this screen, false for the panel.
 */
export function isPushTransitionEnabled(preview: boolean): boolean {
  if (!PUSH_TRANSITION_ENABLED) return false;
  if (typeof window === "undefined") return false;

  try {
    if (new URLSearchParams(window.location.search).get(OPT_OUT_PARAM) === "0") return false;
  } catch {
    /* malformed query string — fall through */
  }

  // prefers-reduced-motion is honoured on a CMS mirror, which is embedded in a
  // real person's browser, and deliberately IGNORED on the panel itself.
  //
  // On Windows that media query is driven by Settings > Accessibility > Visual
  // effects > Animation effects — the same toggle that turns off window and
  // taskbar animations, and a standard thing to switch off when building a
  // kiosk box. Letting it reach the wall meant the content transition silently
  // became a hard cut on exactly the machines most likely to have it disabled,
  // with nothing in the UI to say why. An unattended signage panel also has no
  // viewer whose motion sensitivity the OS setting is speaking for. The escape
  // hatch for a panel that genuinely should not animate is ?pushTransition=0.
  if (!preview) return true;

  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
