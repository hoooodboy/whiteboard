import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { SocketId } from "../../packages/excalidraw/types";
import { collabAPIAtom } from "../collab/Collab";
import {
  deviceStatusAtom,
  loadedWebSocketAtom,
  socketAtom,
  socketUsersAtom,
  subscribersAtom,
} from "../data/atoms";
import { RoomUser, RoomUserRole } from "../data/types";
import userRef from "../data/user";
import webrtcRef, {
  WebRTCUserWithVideoRoomSubscriber,
} from "../data/webrtcJanus";
import Video from "./Video";
import styled from "./WebRTC.module.scss";
import { WebRTCUser } from "./types";

type ConnectedUsers = RoomUser & WebRTCUser;

const WebRTCJanus = () => {
  const localVideoRef = useRef<{ getVideo: () => HTMLVideoElement }>(null);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [socket] = useAtom(socketAtom);
  const socketUsers = useAtomValue(socketUsersAtom);
  const subscribers = useAtomValue(subscribersAtom);
  const [isLoadedWebSocket] = useAtom(loadedWebSocketAtom);

  const [teachers, setTeachers] = useState<ConnectedUsers[]>([]);
  const [students, setStudents] = useState<ConnectedUsers[]>([]);
  const [isMuted] = useState<boolean>(false);
  const deviceStatus = useAtomValue(deviceStatusAtom);

  useEffect(() => {
    // 페이지가 새로고침되면 이전 RTCPeerConnection을 닫고 새로운 연결을 설정합니다.
    window.addEventListener("beforeunload", () => {
      webrtcRef.close();
    });

    return () => {
      webrtcRef.close();
    };
  }, []);

  useEffect(() => {
    if (isLoadedWebSocket) {
      (async () => {
        console.info("start WebRTC Janus");
        await webrtcRef.getDevices();
        webrtcRef.setOnChangeStream((stream) => {
          const videoElement = localVideoRef.current?.getVideo();
          if (videoElement) {
            videoElement.srcObject = stream;
          }
        });
        await webrtcRef.connect();
      })();
    } else {
      webrtcRef.close(); // 연결 끊어지면 비우기
    }

    return () => {
      webrtcRef.close(); // 연결 끊어지면 비우기
    };
  }, [isLoadedWebSocket]);

  useEffect(() => {
    if (webrtcRef.isConnected()) {
      webrtcRef.connect();
    }
  }, [deviceStatus]);

  useEffect(() => {
    const hashWebRtcUsers: {
      [key: string]: WebRTCUserWithVideoRoomSubscriber;
    } = {};
    subscribers.forEach((subscriber) => {
      if (subscriber.user.externalId) {
        hashWebRtcUsers[subscriber.user.externalId || ""] = subscriber;
      }
    });

    // console.log("socketUsers", socketUsers, "hashWebRtcUsers", hashWebRtcUsers);

    const teachersWithoutMe = socketUsers
      .filter(
        (socketUser) =>
          socketUser.role === RoomUserRole.TEACHER &&
          socket?.id !== socketUser.socketId,
      )
      .map((user) => {
        return {
          ...user,
          stream: user.externalId
            ? hashWebRtcUsers[user.externalId]?.user.stream
            : null,
        };
      });
    setTeachers(teachersWithoutMe);

    const studentsWithoutMe = socketUsers
      .filter(
        (socketUser) =>
          socketUser.role === RoomUserRole.STUDENT &&
          socket?.id !== socketUser.socketId,
      )
      .map((user) => {
        return {
          ...user,
          stream: user.externalId
            ? hashWebRtcUsers[user.externalId]?.user.stream
            : null,
        };
      });
    setStudents(studentsWithoutMe);
  }, [socket, socketUsers, subscribers]);

  useEffect(() => {
    if (socket) {
      webrtcRef.setSocket(socket);
    }
  }, [socket]);

  return (
    <>
      <div className={styled.WebRTCContainer}>
        <div className={styled.RTCVideos}>
          {userRef.getUserRole() === RoomUserRole.TEACHER ? (
            <Video
              ref={localVideoRef}
              isVideo={deviceStatus.isVideo}
              isMic={deviceStatus.isMic}
              name={`${userRef.getUser()?.name}`}
              role={userRef.getUserRole()}
              me={true}
              muted={true}
            />
          ) : null}
          {teachers.map((user, index) => (
            <Video
              key={index}
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
          {userRef.getUserRole() === RoomUserRole.STUDENT ? (
            <Video
              ref={localVideoRef}
              isVideo={deviceStatus.isVideo}
              isMic={deviceStatus.isMic}
              name={`${userRef.getUser()?.name}`}
              role={userRef.getUserRole()}
              me={true}
              muted={true}
            />
          ) : null}
          {students.map((user, index) => (
            <Video
              key={index}
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
    </>
  );
};

export default WebRTCJanus;
