import {
  memo,
  forwardRef,
  useState,
  useEffect,
  useImperativeHandle,
  useMemo,
} from "react";
import { RoomUserRole } from "../data/types";
import userRef from "../data/user";
import styled from "./Scene.module.scss";
import slideRef from "../data/slide";
import { debounce } from "../../packages/excalidraw/utils";

const Preview = memo<{
  imageUrl: string;
  alt?: string;
}>(({ imageUrl, alt }) => {
  return (
    <img
      className={styled.thumbnail}
      src={
        imageUrl
          ? imageUrl
          : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect fill='%23C9C9C9' stroke='%23C9C9C9' stroke-width='14' width='15' height='15' x='57.5' y='92.5'%3E%3Canimate attributeName='opacity' calcMode='spline' dur='2' values='1;0;1;' keySplines='.5 0 .5 1;.5 0 .5 1' repeatCount='indefinite' begin='-.4'%3E%3C/animate%3E%3C/rect%3E%3Crect fill='%23C9C9C9' stroke='%23C9C9C9' stroke-width='14' width='15' height='15' x='92.5' y='92.5'%3E%3Canimate attributeName='opacity' calcMode='spline' dur='2' values='1;0;1;' keySplines='.5 0 .5 1;.5 0 .5 1' repeatCount='indefinite' begin='-.2'%3E%3C/animate%3E%3C/rect%3E%3Crect fill='%23C9C9C9' stroke='%23C9C9C9' stroke-width='14' width='15' height='15' x='127.5' y='92.5'%3E%3Canimate attributeName='opacity' calcMode='spline' dur='2' values='1;0;1;' keySplines='.5 0 .5 1;.5 0 .5 1' repeatCount='indefinite' begin='0'%3E%3C/animate%3E%3C/rect%3E%3C/svg%3E"
      }
      alt={alt}
    />
  );
});

type Props = {
  index: number;
  isActive: boolean;
  isRemovable: boolean;
  onSelect: (event: any) => void;
  onRemove: (event: any) => void;
};

export interface SceneRef {
  generateThumbnail: () => void;
}

const Scene = forwardRef(
  ({ index, isActive, isRemovable, onSelect, onRemove }: Props, ref) => {
    useImperativeHandle(ref, () => ({
      generateThumbnail,
    }));
    const [thumbnailUrl, setThumbnailUrl] = useState<string>("");

    const generateThumbnail = useMemo(
      () =>
        debounce(async () => {
          // console.info(`thumb ${index + 1}`);
          const url = await slideRef.createThumb(index);
          setThumbnailUrl(url || "");
        }, 3000),
      [index, setThumbnailUrl],
    );

    useEffect(() => {
      generateThumbnail();
    }, [index, generateThumbnail]);

    return (
      <div
        className={`${styled.scene} ${isActive ? styled["current-scene"] : ""}`}
        onClick={onSelect}
      >
        <Preview imageUrl={thumbnailUrl} alt={`슬라이드 ${index + 1}`} />
        <div className={styled["scene-page-number"]}> {index + 1} </div>
        {userRef.getUserRole() === RoomUserRole.TEACHER ? ( // 선생님만 슬라이드 삭제 가능
          <button
            type="button"
            className={styled["scene-delete"]}
            aria-label="삭제"
            disabled={!isRemovable}
            onClick={onRemove}
          >
            &#x2716;
          </button>
        ) : null}
      </div>
    );
  },
);

export default Scene;
