import "./index.css";
import { Composition } from "remotion";
import { Intro, introDefaultProps } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Intro"
      component={Intro}
      durationInFrames={120}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={introDefaultProps}
    />
  );
};
