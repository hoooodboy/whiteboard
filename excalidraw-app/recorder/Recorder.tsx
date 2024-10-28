import { useAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { FormEvent, useCallback, useEffect, useMemo, useRef } from "react";
import { playerStatusAtom, recordInfoAtom } from "../data/atoms";
import playerRef from "../data/player";
// import recorderRef from "../data/recorder";
import { PlayerStatusEnum } from "../data/types";
import styled from "./Recorder.module.scss";

const SeekableBar = ({
  onChangeSeek,
}: {
  onChangeSeek: (seek: number) => Promise<boolean>;
}) => {
  const [recordInfo] = useAtom(recordInfoAtom);

  return (
    <>
      <input
        type="range"
        value={recordInfo.seek}
        min={0}
        max={recordInfo.seekLength}
        onInput={(e: FormEvent<HTMLInputElement>) => {
          onChangeSeek(parseInt((e.target as HTMLInputElement)?.value));
        }}
      />
    </>
  );
};

const SeekableVideo = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaUrl] = useAtom(
    useMemo(() => selectAtom(recordInfoAtom, (v) => v.mediaUrl), []),
  );

  useEffect(() => {
    if (videoRef && videoRef.current && mediaUrl) {
      videoRef.current.src = mediaUrl;
    }
  }, [mediaUrl]);

  useEffect(() => {
    playerRef.setVideoElement(videoRef.current);
    return () => {
      playerRef.setVideoElement(null);
    };
  }, [videoRef]);

  return (
    <>
      <video ref={videoRef} />
    </>
  );
};

const ControlReplay = () => {
  const [recorderStatus] = useAtom(playerStatusAtom);

  // const toggleRecording = useCallback(async () => {
  //   return await recorderRef.toggleRecording();
  // }, []);

  const playPlayer = useCallback(async (seek?: number) => {
    return await playerRef.play(seek);
  }, []);

  // const playTestPlayer = useCallback(async (seek?: number) => {
  //   return await playerRef.loadTest();
  // }, []);

  const pausePlayer = useCallback(async () => {
    return await playerRef.pause();
  }, []);

  return (
    <>
      {/* <button
        className="btn"
        onClick={() => {
          playTestPlayer();
        }}
      >
        ❤
      </button> */}
      <button
        className="btn"
        onClick={() => {
          if (recorderStatus === PlayerStatusEnum.PLAYING) {
            pausePlayer();
          } else {
            playPlayer();
          }
        }}
      >
        {recorderStatus === PlayerStatusEnum.PLAYING ? (
          <i className="wb-icon wb-icon-pause"></i>
        ) : (
          <i className="wb-icon wb-icon-play"></i>
        )}
      </button>
      {/* <button className="btn" onClick={() => toggleRecording()}>
        {recorderStatus === PlayerStatusEnum.RECORDING ? (
          <i className="wb-icon wb-icon-record-on"></i>
        ) : (
          <i className="wb-icon wb-icon-record-off"></i>
        )}
      </button> */}
    </>
  );
};

const Recorder = () => {
  const seekPlayer = useCallback(async (seek: number) => {
    return await playerRef.seek(seek);
  }, []);

  return (
    <div className={styled.Recorder}>
      <div className={styled.ControlButtonBox}>
        <ControlReplay></ControlReplay>
      </div>
      <div className={styled.ControlRangeBox}>
        <SeekableBar
          onChangeSeek={(seek: number) => seekPlayer(seek)}
        ></SeekableBar>
      </div>
      <div className={styled.VideoBox}>
        <SeekableVideo></SeekableVideo>
      </div>
    </div>
  );
};

export default Recorder;
