import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DateTitle, Folder, Phone, TermSheet, WallClock } from "./Overlays";
import { FPS, Line, Overlay, Shot, shots, totalSeconds } from "./shots";

export const EPISODE1_FRAMES = totalSeconds * FPS;

const BACKGROUNDS = {
  cold: "linear-gradient(180deg, #1c2430 0%, #2b3644 55%, #151a22 100%)",
  warm: "linear-gradient(180deg, #1e1d22 0%, #3a3127 55%, #17151a 100%)",
};

const OVERLAYS: Record<Overlay, React.FC> = {
  dateTitle: DateTitle,
  termSheet: TermSheet,
  phone: Phone,
  wallClock: WallClock,
  folder: Folder,
};

const Placeholder: React.FC<{ shot: Shot }> = ({ shot }) => (
  <AbsoluteFill style={{ background: BACKGROUNDS[shot.tone] }}>
    <div className="absolute left-16 right-16 top-16 flex justify-between text-2xl tracking-widest text-white/40">
      <span>КАДР {String(shot.id).padStart(2, "0")}</span>
      <span>{shot.dur} С</span>
    </div>
    <div className="absolute bottom-[300px] left-16 right-16 text-white/45">
      <div className="text-2xl tracking-widest">
        {shot.location.toUpperCase()}
      </div>
      <div className="mt-3 text-3xl leading-snug">{shot.action}</div>
      <div className="mt-3 text-2xl text-white/30">{shot.characters}</div>
    </div>
  </AbsoluteFill>
);

const Subtitle: React.FC<{ line: Line }> = ({ line }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const len = Math.round(line.dur * fps) + 8;
  const opacity = interpolate(frame, [0, 4, len - 4, len], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      className="items-center justify-end"
      style={{ paddingBottom: 150 }}
    >
      <div
        className="max-w-[900px] rounded-xl bg-black/55 px-8 py-4 text-center text-5xl leading-tight text-white"
        style={{ opacity }}
      >
        {line.text}
      </div>
    </AbsoluteFill>
  );
};

const ShotView: React.FC<{ shot: Shot }> = ({ shot }) => {
  const { fps } = useVideoConfig();
  const Over = shot.overlay ? OVERLAYS[shot.overlay] : null;
  return (
    <AbsoluteFill>
      {shot.clip ? (
        <OffthreadVideo src={staticFile(shot.clip)} muted />
      ) : (
        <Placeholder shot={shot} />
      )}
      {Over ? <Over /> : null}
      {shot.sfx?.map((s, i) => (
        <Sequence key={`sfx${i}`} from={Math.round(s.at * fps)}>
          <Audio src={staticFile(`ep1/${s.file}.wav`)} volume={s.volume ?? 1} />
        </Sequence>
      ))}
      {shot.lines?.map((l) => (
        <Sequence
          key={l.file}
          from={Math.round(l.at * fps)}
          durationInFrames={Math.round(l.dur * fps) + 8}
        >
          <Audio src={staticFile(`ep1/${l.file}.wav`)} volume={l.volume ?? 1} />
          <Subtitle line={l} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      className="items-center justify-center bg-black"
      style={{ opacity }}
    >
      <div className="text-7xl font-light tracking-[0.25em] text-white">
        ПРОТЯНУТАЯ
      </div>
      <div className="mt-4 text-7xl font-light tracking-[0.25em] text-white">
        РУКА
      </div>
    </AbsoluteFill>
  );
};

export const Episode1: React.FC = () => {
  const { fps } = useVideoConfig();
  let start = 0;
  return (
    <AbsoluteFill className="bg-black">
      <Audio src={staticFile("ep1/drone.wav")} volume={0.3} />
      {shots.map((shot) => {
        const from = start;
        start += shot.dur * fps;
        return (
          <Sequence key={shot.id} from={from} durationInFrames={shot.dur * fps}>
            <ShotView shot={shot} />
          </Sequence>
        );
      })}
      <Sequence from={EPISODE1_FRAMES - Math.round(2.5 * fps)}>
        <TitleCard />
      </Sequence>
    </AbsoluteFill>
  );
};
