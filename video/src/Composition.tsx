import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type IntroProps = {
  title: string;
  subtitle: string;
};

export const introDefaultProps: IntroProps = {
  title: "SaaS Starter",
  subtitle: "Запускайте продукт быстрее",
};

const Title: React.FC<IntroProps> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleIn = spring({ frame, fps, config: { damping: 200 } });
  const subtitleIn = spring({ frame: frame - 20, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill className="items-center justify-center text-center">
      <h1
        className="text-9xl font-bold text-white"
        style={{
          opacity: titleIn,
          transform: `translateY(${interpolate(titleIn, [0, 1], [60, 0])}px)`,
        }}
      >
        {title}
      </h1>
      <p
        className="mt-8 text-5xl text-indigo-200"
        style={{
          opacity: subtitleIn,
          transform: `translateY(${interpolate(subtitleIn, [0, 1], [40, 0])}px)`,
        }}
      >
        {subtitle}
      </p>
    </AbsoluteFill>
  );
};

export const Intro: React.FC<IntroProps> = (props) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const hue = interpolate(frame, [0, durationInFrames], [240, 290]);
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 18%), hsl(${hue + 40} 70% 35%))`,
        opacity: fadeOut,
      }}
    >
      <Sequence from={10}>
        <Title {...props} />
        <Audio src={staticFile("voiceover.wav")} />
      </Sequence>
    </AbsoluteFill>
  );
};
