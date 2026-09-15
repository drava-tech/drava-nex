import { getScreens, getActiveScreens } from "@/actions/screen-actions";
import { setScreenBlanked as setScreenBlankedAction } from "@/actions/screen-actions";
import { screensHydrated, activeScreensUpdated, screenBlankedSet } from "./screens-slice";
import type { AppDispatch, RootState } from "./index";

/**
 * Client-side load of the screen list, for surfaces that aren't rendered by a
 * server page (the push-to-screen modal opens on demand). Pages that DO have a
 * server component keep loading there and dispatch `screensHydrated` with the
 * props — that stays faster than fetching from the browser.
 */
export const fetchScreens = () => async (dispatch: AppDispatch) => {
  try {
    const [rows, activeIds] = await Promise.all([getScreens(), getActiveScreens()]);
    dispatch(screensHydrated(rows));
    dispatch(activeScreensUpdated(activeIds));
  } catch (err) {
    console.error("Failed to load screens:", err);
  }
};

/**
 * Blank/resume a screen, optimistically. Rolls back if the write fails —
 * otherwise the toggle would sit showing a state the hardware never reached.
 * Same shape as the lighting writes in environment-view.tsx.
 */
export const setScreenBlanked =
  (screenId: string, blanked: boolean) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const previous = getState().screens.rows.find((s) => s.screenId === screenId)?.blanked ?? false;
    dispatch(screenBlankedSet({ screenId, blanked }));
    try {
      await setScreenBlankedAction(screenId, blanked);
    } catch (err) {
      console.error("Failed to set blanked:", err);
      dispatch(screenBlankedSet({ screenId, blanked: previous }));
      throw err;
    }
  };
