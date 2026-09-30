import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./index";

/**
 * Pre-typed versions of the react-redux hooks — use these instead of the bare
 * ones so selectors know the state shape and dispatch accepts thunks.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
