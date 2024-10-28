import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { SocketId } from "../../packages/excalidraw/types";
import { collabAPIAtom } from "../collab/Collab";
import {
  deviceStatusAtom,
  loadedWebSocketAtom,
  socketAtom,
  socketUsersAtom,
  webRTCUsersAtom,
} from "../data/atoms";
import { RoomUser, RoomUserRole } from "../data/types";
import userRef from "../data/user";
import webrtcRef from "../data/webrtc";
import Video from "./Video";
import styled from "./WebRTC.module.scss";
import { WebRTCUser } from "./types";

type ConnectedUsers = RoomUser & WebRTCUser;

const WebRTC = () => {
  const localVideoRef = useRef<{ getVideo: () => HTMLVideoElement }>(null);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [socket] = useAtom(socketAtom);
  const socketUsers = useAtomValue(socketUsersAtom);
  const webRtcUsers = useAtomValue(webRTCUsersAtom);
  const [isLoadedWebSocket] = useAtom(loadedWebSocketAtom);

  const [teachers, setTeachers] = useState<ConnectedUsers[]>([]);
  const [students, setStudents] = useState<ConnectedUsers[]>([]);
  const [isMuted] = useState<boolean>(false);
  const deviceStatus = useAtomValue(deviceStatusAtom);

  // 스트림 업데이트를 처리하는 함수
  const handleStreamUpdate = useCallback(async (user: ConnectedUsers) => {
    if (!user.socketId) return;

    const existingVideo = document.querySelector(
      `[data-socket-id="${user.socketId}"] video`,
    ) as HTMLVideoElement;

    if (existingVideo) {
      if (user.stream && existingVideo.srcObject !== user.stream) {
        existingVideo.srcObject = user.stream;
        try {
          await existingVideo.play();
        } catch (err) {
          console.error("Failed to play new stream:", err);
        }
      } else if (!user.stream && existingVideo.srcObject) {
        existingVideo.srcObject = null;
      }
    }
  }, []);

  // WebRTC 연결 초기화 및 스트림 설정
  const initializeWebRTC = useCallback(async () => {
    console.info("start WebRTC");
    await webrtcRef.getDevices();
    webrtcRef.setOnChangeStream((stream) => {
      const videoElement = localVideoRef.current?.getVideo();
      if (videoElement) {
        videoElement.srcObject = stream;
      }
    });
    await webrtcRef.connect();
  }, []);

  useEffect(() => {
    if (isLoadedWebSocket) {
      initializeWebRTC();
    } else {
      webrtcRef.close();
    }

    return () => {
      webrtcRef.close();
    };
  }, [isLoadedWebSocket, initializeWebRTC]);

  // 디바이스 상태 변경 시 처리
  useEffect(() => {
    if (webrtcRef.isConnected()) {
      const currentLocalStream = webrtcRef.getLocalStream();
      if (!currentLocalStream && deviceStatus.isVideo) {
        webrtcRef.connect();
      }
    }
  }, [deviceStatus]);

  // 사용자 목록 업데이트 및 스트림 동기화
  const updateUserLists = useCallback(() => {
    const hashWebRtcUsers: { [key: string]: WebRTCUser } = {};
    webRtcUsers.forEach((user) => {
      hashWebRtcUsers[user.socketId] = user;
    });

    const teachersWithoutMe = socketUsers
      .filter(
        (socketUser) =>
          socketUser.role === RoomUserRole.TEACHER &&
          socket?.id !== socketUser.socketId,
      )
      .map((user) => ({
        ...user,
        stream: hashWebRtcUsers[user.socketId]?.stream || null,
      }));

    const studentsWithoutMe = socketUsers
      .filter(
        (socketUser) =>
          socketUser.role === RoomUserRole.STUDENT &&
          socket?.id !== socketUser.socketId,
      )
      .map((user) => ({
        ...user,
        stream: hashWebRtcUsers[user.socketId]?.stream || null,
      }));

    setTeachers(teachersWithoutMe);
    setStudents(studentsWithoutMe);

    // 모든 사용자의 스트림 업데이트
    [...teachersWithoutMe, ...studentsWithoutMe].forEach(handleStreamUpdate);
  }, [socket, socketUsers, webRtcUsers, handleStreamUpdate]);

  useEffect(() => {
    updateUserLists();
  }, [updateUserLists]);

  // WebRTC 스트림 변경 감지 및 업데이트
  useEffect(() => {
    const hashWebRtcUsers: { [key: string]: WebRTCUser } = {};
    webRtcUsers.forEach((user) => {
      hashWebRtcUsers[user.socketId] = user;
    });

    [...teachers, ...students].forEach((user) => {
      const webRtcUser = hashWebRtcUsers[user.socketId];
      if (webRtcUser && webRtcUser.stream !== user.stream) {
        handleStreamUpdate({ ...user, stream: webRtcUser.stream });
      }
    });
  }, [webRtcUsers, handleStreamUpdate, teachers, students]);

  useEffect(() => {
    if (socket) {
      webrtcRef.setSocket(socket);
    }
  }, [socket]);

  // beforeunload 이벤트 처리
  useEffect(() => {
    const handleBeforeUnload = () => {
      webrtcRef.close();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      webrtcRef.close();
    };
  }, []);

  return (
    <div className={styled.WebRTCContainer}>
      <div className={styled.RTCVideos}>
        {userRef.getUserRole() === RoomUserRole.TEACHER && (
          <Video
            ref={localVideoRef}
            isVideo={deviceStatus.isVideo}
            isMic={deviceStatus.isMic}
            name={`${userRef.getUser()?.name}`}
            role={userRef.getUserRole()}
            me={true}
            muted={true}
            data-socket-id={socket?.id}
          />
        )}

        {teachers.map((user) => (
          <Video
            key={user.socketId}
            data-socket-id={user.socketId}
            name={user.name}
            stream={user.stream}
            isVideo={user.isVideo}
            isMic={user.isMic}
            muted={false}
            role={user.role as RoomUserRole}
            userLabelEvents={{
              onClick: (event: any) => {
                event.stopPropagation();
                collabAPI?.followUser({
                  userToFollow: {
                    socketId: user.socketId as SocketId,
                    username: user.name,
                  },
                  action: "FOLLOW",
                });
              },
            }}
          />
        ))}

        {userRef.getUserRole() === RoomUserRole.STUDENT && (
          <Video
            ref={localVideoRef}
            isVideo={deviceStatus.isVideo}
            isMic={deviceStatus.isMic}
            name={`${userRef.getUser()?.name}`}
            role={userRef.getUserRole()}
            me={true}
            muted={true}
            data-socket-id={socket?.id}
          />
        )}

        {students.map((user) => (
          <Video
            key={user.socketId}
            data-socket-id={user.socketId}
            name={user.name}
            stream={user.stream}
            isVideo={user.isVideo}
            isMic={user.isMic}
            muted={isMuted}
            role={user.role as RoomUserRole}
            userLabelEvents={{
              onClick: (event: any) => {
                event.stopPropagation();
                collabAPI?.followUser({
                  userToFollow: {
                    socketId: user.socketId as SocketId,
                    username: user.name,
                  },
                  action: "FOLLOW",
                });
              },
            }}
            userMicEvents={{
              onClick: (event: any) => {
                event.stopPropagation();
                webrtcRef.toggleMicFromTeacher(user.socketId as SocketId);
              },
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default WebRTC;
