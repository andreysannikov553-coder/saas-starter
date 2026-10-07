import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const fadeIn = (frame: number, start: number, len = 12) =>
  interpolate(frame, [start, start + len], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const DateTitle: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="items-center" style={{ paddingTop: 260 }}>
      <div
        className="text-4xl tracking-[0.3em] text-white/80"
        style={{ opacity: fadeIn(frame, 15, 20) }}
      >
        15 ОКТЯБРЯ · 07:40
      </div>
    </AbsoluteFill>
  );
};

export const TermSheet: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="items-center justify-center">
      <div
        className="w-[760px] rounded-xl bg-slate-100/90 px-14 py-16 text-slate-800 shadow-2xl"
        style={{ opacity: fadeIn(frame, 0, 10) }}
      >
        <div className="text-2xl tracking-[0.25em] text-slate-500">
          КОНФИДЕНЦИАЛЬНО
        </div>
        <div className="mt-8 text-5xl font-semibold">Раунд B</div>
        <div className="mt-4 text-7xl font-bold">$12 000 000</div>
        <div className="mt-10 text-3xl text-slate-600">
          Подписание сегодня · 11:00
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Notification: React.FC<{
  title: string;
  body: string;
  start: number;
}> = ({ title, body, start }) => {
  const frame = useCurrentFrame();
  const appear = fadeIn(frame, start, 8);
  return (
    <div
      className="rounded-3xl bg-white/15 px-8 py-6 text-white backdrop-blur"
      style={{
        opacity: appear,
        transform: `translateY(${(1 - appear) * -30}px)`,
      }}
    >
      <div className="flex justify-between text-2xl text-white/60">
        <span>{title}</span>
        <span>07:42</span>
      </div>
      <div className="mt-2 text-3xl leading-snug">{body}</div>
    </div>
  );
};

export const Phone: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill className="items-center" style={{ paddingTop: 180 }}>
      <div className="flex h-[1080px] w-[640px] flex-col gap-6 rounded-[80px] border-4 border-white/20 bg-slate-950/80 px-8 pt-32">
        <div className="text-center text-8xl font-light text-white/90">
          07:42
        </div>
        <div className="mb-10 text-center text-3xl text-white/50">
          среда, 15 октября
        </div>
        <Notification
          title="Лёва"
          body="Видел. Еду."
          start={Math.round(2.4 * fps)}
        />
        <Notification
          title="Новости"
          body="Утечка данных клиентов «Ладьи»: в сети внутренняя переписка CEO"
          start={Math.round(0.3 * fps)}
        />
      </div>
    </AbsoluteFill>
  );
};

export const WallClock: React.FC = () => {
  // 07:51 — hour hand just before eight, minute hand at 51.
  const minuteDeg = 51 * 6;
  const hourDeg = (7 + 51 / 60) * 30;
  return (
    <AbsoluteFill className="items-center" style={{ paddingTop: 150 }}>
      <svg width="300" height="300" viewBox="-100 -100 200 200">
        <circle r="92" fill="#e9e6df" stroke="#1d1d1f" strokeWidth="6" />
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            x1="0"
            y1="-82"
            x2="0"
            y2={i % 3 === 0 ? -64 : -72}
            stroke="#1d1d1f"
            strokeWidth={i % 3 === 0 ? 6 : 3}
            transform={`rotate(${i * 30})`}
          />
        ))}
        <line
          x1="0"
          y1="8"
          x2="0"
          y2="-45"
          stroke="#1d1d1f"
          strokeWidth="7"
          strokeLinecap="round"
          transform={`rotate(${hourDeg})`}
        />
        <line
          x1="0"
          y1="10"
          x2="0"
          y2="-70"
          stroke="#1d1d1f"
          strokeWidth="4"
          strokeLinecap="round"
          transform={`rotate(${minuteDeg})`}
        />
        <circle r="5" fill="#1d1d1f" />
      </svg>
    </AbsoluteFill>
  );
};

export const Folder: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // The folder is turned face down at 3s.
  const visible = interpolate(frame, [2.6 * fps, 3.2 * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      className="items-center justify-end"
      style={{ paddingBottom: 520 }}
    >
      <div
        className="flex h-[360px] w-[620px] items-start justify-end rounded-lg bg-[#1b2a4a] p-8 shadow-2xl"
        style={{
          opacity: visible,
          transform: `rotateX(${(1 - visible) * 80}deg)`,
        }}
      >
        <div className="rounded bg-[#efe9dc] px-6 py-3 text-4xl font-semibold text-[#1b2a4a]">
          14.10
        </div>
      </div>
    </AbsoluteFill>
  );
};
