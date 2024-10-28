import { useEffect } from "react";
import "./Loading.scss";
import { useAtom } from "jotai";
import { loadingUIAtom, isLoadingAtom } from "./atom";

const Loading = () => {
  const [loadingUI, setLoadingUI] = useAtom(loadingUIAtom);
  const [isLoading] = useAtom(isLoadingAtom);

  useEffect(() => {
    if (!isLoading) {
      setLoadingUI(null);
    }
  }, [isLoading, setLoadingUI]);

  return (
    <div className="Loading">
      <div className={`loader ${isLoading ? "active" : ""}`}>
        <div className={`loading ${loadingUI?.icon}`}>
          <div className="loading-inner"></div>
          <span>{loadingUI?.message}</span>
        </div>
      </div>
    </div>
  );
};

export default Loading;
