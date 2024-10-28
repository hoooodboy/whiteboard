import { RoomUserRole } from "./types";

const getUserRole = () => {
  const hash = new URL(window.location.href).hash;
  const match = hash.match(/[#&?]{1}userRole=([a-zA-Z0-9_-]+)/);
  if (match && match[1].length < 1) {
    return RoomUserRole.STUDENT;
  }
  return match ? match[1] : RoomUserRole.STUDENT;
};

export const userRole = getUserRole();
