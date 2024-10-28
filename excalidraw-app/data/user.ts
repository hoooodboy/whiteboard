import { nanoid } from "nanoid";
import type { UserData } from "./types";
import { RoomUserRole } from "./types";

class userRef {
  protected user: UserData | null = null;

  public constructor() {
    this.user = null;
  }
  public setUser = (user?: UserData | null) => {
    if (user) {
      this.user = user;
    }
  };

  public getUser = () => {
    return this.user;
  };

  public setAnonymousUser = (name?: string) => {
    const user = this.getUser();
    const saveName = name || `Anonymous ${nanoid(5)}`;
    if (user) {
      this.setUser({
        ...user,
        name: saveName,
      });
    } else {
      const uid = nanoid(40);
      this.setUser({
        userId: uid,
        name: name || `Anonymous ${nanoid(5)}`,
        role: this.getUserRole(),
      });
    }
    return this.getUser();
  };

  protected getUserRoleFromUrl = () => {
    const hash = new URL(window.location.href).hash;
    const match = hash.match(/[#&?]{1}userRole=([a-zA-Z0-9_-]+)/);
    if (match && match[1].length < 1) {
      return null;
    }
    if (match && match[1]) {
      const urlRole = (match[1] || "").toUpperCase();
      switch (urlRole) {
        case RoomUserRole.TEACHER:
          return RoomUserRole.TEACHER;
        case RoomUserRole.STUDENT:
          return RoomUserRole.STUDENT;
        case RoomUserRole.SPECTATOR:
          return RoomUserRole.SPECTATOR;
      }
    }
    return null;
  };

  public getUserRole = (): RoomUserRole => {
    return this.user?.role || this.getUserRoleFromUrl() || RoomUserRole.STUDENT;
  };
}

export default new userRef();
