import "./index.css";
import { Composition } from "remotion";
import { Intro, introDefaultProps } from "./Composition";
import { Episode1, EPISODE1_FRAMES } from "./episode1/Episode1";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Intro"
        component={Intro}
        durationInFrames={120}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={introDefaultProps}
      />
      <Composition
        id="Episode1"
        component={Episode1}
        durationInFrames={EPISODE1_FRAMES}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
