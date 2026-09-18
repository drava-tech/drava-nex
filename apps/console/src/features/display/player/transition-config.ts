// Ported from cms-platform apps/cms/src/lib/display/transition-config.ts.

/** Query param that turns the push-up transition off for one screen. */
const OPT_OUT_PARAM = "pushTransition"

/**
 * Read once per mount, not reactively — whether a panel animates is a property
 * of the installation, and re-deciding it mid-session would strand a push
 * halfway through.
 *
 * The escape hatch is `?pushTransition=0` on the display URL: for a signage
 * appliance with a single hardware video decoder, which cannot hold two
 * videos during the 1.5 s overlap.
 *
 * prefers-reduced-motion is honoured for a console preview (a real person's
 * browser) and deliberately IGNORED on the panel: on Windows it is driven by
 * the "Animation effects" setting that kiosk builds commonly switch off, and
 * an unattended panel has no viewer whose preference that setting speaks for.
 */
export function isPushTransitionEnabled(preview: boolean): boolean {
  try {
    if (new URLSearchParams(window.location.search).get(OPT_OUT_PARAM) === "0") return false
  } catch {
    /* malformed query string — fall through */
  }
  if (!preview) return true
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}
