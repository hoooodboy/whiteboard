interface Window {
  __EXCALIDRAW_SHA__: string | undefined;
}

declare interface HTMLMediaElement {
  sinkId?: string;
  setSinkId?: (sinkId: string) => Promise<void>;
}
