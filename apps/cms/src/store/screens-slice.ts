import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
// The canonical row, defined once beside the query that produces it
// (packages/db/src/queries/screens.ts). Type-only, so nothing server-side ends
// up in the client bundle.
import type { ScreenRow } from "@platform/db";

export interface ScreensState {
  rows: ScreenRow[];
  /**
   * Screen ids currently connected, from ACTIVE_SCREENS_LIST.
   *
   * An array rather than a Set: Redux state must stay serialisable (RTK's dev
   * checks warn on a Set, and it wouldn't survive devtools time-travel).
   * Components that need membership tests build their own Set in a useMemo.
   */
  activeIds: string[];
}

const initialState: ScreensState = { rows: [], activeIds: [] };

/** Sentinel the gateway sends for "nothing assigned" — see IDLE_WS_CONTENT. */
const IDLE_ID = "__idle__";

const screensSlice = createSlice({
  name: "screens",
  initialState,
  reducers: {
    /** Seed from a server component's props. */
    screensHydrated(state, action: PayloadAction<ScreenRow[]>) {
      state.rows = action.payload;
    },

    /**
     * One screen's content changed — from our own optimistic push, or from the
     * WebSocket echo of a change made anywhere else.
     *
     * The payload is the *row's* language, not the wire format: WsContent
     * collapses PDF/sheet/slides/word all into type "html", but the row keeps
     * the asset's real type because that is what the "now showing" label
     * renders. Each caller translates into this shape — StoreSync from
     * WsContent, publish-board from its own card — so the row-patching logic
     * still lives in exactly one place.
     */
    screenContentUpdated(
      state,
      action: PayloadAction<{
        screenId: string;
        kind: "media" | "experience";
        id: string;
        title: string | null;
        mediaType?: string | null;
        mediaUrl?: string | null;
      }>,
    ) {
      const { screenId, kind, id, title, mediaType, mediaUrl } = action.payload;
      const row = state.rows.find((s) => s.screenId === screenId);
      if (!row) return;

      // Reset-to-idle arrives as a sentinel id, not a real asset. Clearing the
      // assignment here means every surface reads "nothing assigned" — before
      // this, only screens-table special-cased it and the others displayed the
      // sentinel as if it were a real media asset.
      if (id === IDLE_ID) {
        row.currentContentKind = null;
        row.currentMediaAssetId = null;
        row.currentExperienceId = null;
        row.mediaType = null;
        row.mediaUrl = null;
        row.mediaName = null;
        row.experienceName = null;
        return;
      }

      if (kind === "media") {
        row.currentContentKind = "media";
        row.currentMediaAssetId = id;
        row.mediaType = mediaType ?? row.mediaType;
        row.mediaUrl = mediaUrl ?? row.mediaUrl;
        row.mediaName = title;
      } else {
        row.currentContentKind = "experience";
        row.currentExperienceId = id;
        row.experienceName = title;
      }
    },

    /** Which screens are currently connected, from ACTIVE_SCREENS_LIST. */
    activeScreensUpdated(state, action: PayloadAction<string[]>) {
      state.activeIds = action.payload;
    },

    /** Optimistic blank/resume, confirmed later by the row's own refresh. */
    screenBlankedSet(state, action: PayloadAction<{ screenId: string; blanked: boolean }>) {
      const row = state.rows.find((s) => s.screenId === action.payload.screenId);
      if (row) row.blanked = action.payload.blanked;
    },
  },
});

export const {
  screensHydrated,
  screenContentUpdated,
  activeScreensUpdated,
  screenBlankedSet,
} = screensSlice.actions;
export default screensSlice.reducer;