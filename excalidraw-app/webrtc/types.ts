export type WebRTCUser = {
  socketId: string;
  stream: MediaStream | null;
};

export type DeviceStatus = {
  isVideo: boolean;
  isMic: boolean;
  videoDeviceId: string | null;
  micDeviceId: string | null;
  audioDeviceId: string | null; // FIXED: to audioDeviceId
};
