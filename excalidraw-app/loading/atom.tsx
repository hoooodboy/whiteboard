import { atom } from "jotai";
import { LoadingUI } from "./types";

export const loadingUIAtom = atom<LoadingUI | null>(null);
export const isLoadingAtom = atom<boolean>(false);
