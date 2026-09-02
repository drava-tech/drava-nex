import { configureStore } from "@reduxjs/toolkit";
import audioReducer from "./audio-slice";
import screensReducer from "./screens-slice";

/**
 * Created per client rather than once at module scope — a module-level store
 * would be shared between different users' requests during server rendering.
 * StoreProvider holds the instance in a ref; see store-provider.tsx.
 *
 * Only `audio` lives here today. Screens and the media library are the obvious
 * next slices (each is currently duplicated across several components), but
 * converting them is deliberately out of scope.
 */
export const makeStore = () =>
  configureStore({
    reducer: {
      audio: audioReducer,
      screens: screensReducer,
    },
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
