export type Tone = "cold" | "warm";

export type Line = {
  /** File in public/ep1 without extension. */
  file: string;
  /** Start, in seconds from the beginning of the shot. */
  at: number;
  /** Length of the voice line, in seconds. */
  dur: number;
  text: string;
  volume?: number;
};

export type Sfx = { file: string; at: number; volume?: number };

export type Overlay =
  | "dateTitle"
  | "termSheet"
  | "phone"
  | "wallClock"
  | "folder";

export type Shot = {
  id: number;
  dur: number;
  location: string;
  characters: string;
  action: string;
  tone: Tone;
  /** Generated clip in public/, e.g. "ep1/shot01.mp4". Placeholder when unset. */
  clip?: string;
  overlay?: Overlay;
  lines?: Line[];
  sfx?: Sfx[];
};

export const FPS = 30;

export const shots: Shot[] = [
  {
    id: 1,
    dur: 5,
    location: "Офис «Ладьи» · рассвет",
    characters: "Даниил",
    action: "Даниил один у огромного окна. Город только просыпается.",
    tone: "cold",
    overlay: "dateTitle",
  },
  {
    id: 2,
    dur: 4,
    location: "Стол Даниила",
    characters: "Даниил (руки)",
    action: "Документ сделки на ноутбуке. Даниил поправляет ремешок часов.",
    tone: "cold",
    overlay: "termSheet",
    sfx: [{ file: "tick", at: 0, volume: 0.8 }],
  },
  {
    id: 3,
    dur: 6,
    location: "Стол Даниила",
    characters: "Даниил, Алина",
    action: "Алина ставит кофе перед Даниилом.",
    tone: "cold",
    lines: [
      { file: "s03_a1", at: 0.8, dur: 1.72, text: "Подпишем — и спим неделю." },
      { file: "s03_d1", at: 2.9, dur: 0.66, text: "Месяц." },
      { file: "s03_a2", at: 3.9, dur: 0.96, text: "Не наглей." },
    ],
  },
  {
    id: 4,
    dur: 5,
    location: "Опен-спейс",
    characters: "Алина, сотрудники",
    action: "По столам вибрируют телефоны. Лицо Алины каменеет.",
    tone: "cold",
    sfx: [
      { file: "buzz", at: 0.3 },
      { file: "buzz", at: 1.1, volume: 0.7 },
      { file: "buzz", at: 1.6, volume: 0.5 },
      { file: "buzz", at: 2.4, volume: 0.6 },
    ],
  },
  {
    id: 5,
    dur: 5,
    location: "Телефон Даниила",
    characters: "Даниил (руки)",
    action: "Новость о скандале. Сверху — второе сообщение.",
    tone: "cold",
    overlay: "phone",
    sfx: [
      { file: "ping", at: 0.3 },
      { file: "heartbeat", at: 1.2 },
      { file: "ping", at: 2.4 },
    ],
  },
  {
    id: 6,
    dur: 6,
    location: "У окна",
    characters: "Даниил",
    action: "Даниил слушает телефон и медленно опускает руку.",
    tone: "cold",
    lines: [
      {
        file: "s06_p1",
        at: 0.3,
        dur: 3.61,
        text: "Григорий Аркадьевич просил передать: встреча переносится.",
        volume: 0.6,
      },
      { file: "s06_d1", at: 4.0, dur: 0.62, text: "На когда?" },
      {
        file: "s06_p2",
        at: 4.8,
        dur: 1.17,
        text: "Он вам перезвонит.",
        volume: 0.6,
      },
    ],
  },
  {
    id: 7,
    dur: 7,
    location: "Между колоннами",
    characters: "Даниил, Алина",
    action: "Они стоят по разные стороны бетонной колонны.",
    tone: "cold",
    lines: [
      { file: "s07_a1", at: 0.6, dur: 1.05, text: "Это не мы." },
      { file: "s07_d1", at: 2.0, dur: 0.52, text: "Знаю." },
      {
        file: "s07_a2",
        at: 3.2,
        dur: 1.94,
        text: "Эту переписку видели трое.",
      },
    ],
  },
  {
    id: 8,
    dur: 6,
    location: "Входные двери офиса",
    characters: "Лев",
    action: "Лев входит с двумя стаканами кофе. Офис провожает его взглядом.",
    tone: "warm",
    overlay: "wallClock",
    sfx: [{ file: "tick", at: 0, volume: 0.9 }],
  },
  {
    id: 9,
    dur: 8,
    location: "Стол Даниила",
    characters: "Лев, Даниил",
    action: "Лев ставит кофе и кладёт телефон экраном вниз.",
    tone: "warm",
    lines: [
      {
        file: "s09_l1",
        at: 0.8,
        dur: 2.29,
        text: "Сначала дыши. Звонки потом.",
      },
      { file: "s09_d1", at: 3.6, dur: 1.1, text: "Остапов отменил." },
      {
        file: "s09_l2",
        at: 5.2,
        dur: 2.53,
        text: "Двенадцать миллионов — не конец света.",
      },
    ],
  },
  {
    id: 10,
    dur: 7,
    location: "У окна",
    characters: "Даниил, Лев",
    action: "Даниил впервые просит. Рука Льва ложится ему на плечо.",
    tone: "warm",
    lines: [
      { file: "s10_d1", at: 0.6, dur: 0.29, text: "Лёв." },
      { file: "s10_d2", at: 1.8, dur: 1.21, text: "Мне нужна помощь." },
      { file: "s10_l1", at: 4.2, dur: 1.99, text: "Я рядом. Разберёмся." },
    ],
    sfx: [{ file: "piano", at: 3.6, volume: 0.8 }],
  },
  {
    id: 11,
    dur: 5,
    location: "Вид из окна на улицу",
    characters: "Даниил и Лев (спиной), Остапов (внизу)",
    action: "Внизу человек в угольном пальто смотрит на окна и уезжает.",
    tone: "cold",
  },
  {
    id: 12,
    dur: 9,
    location: "Машина Льва",
    characters: "Лев",
    action: "Улыбка уходит. Лев переворачивает папку лицом вниз.",
    tone: "warm",
    overlay: "folder",
    sfx: [
      { file: "rain", at: 0 },
      { file: "buzz", at: 4.8, volume: 0.4 },
    ],
  },
];

export const totalSeconds = shots.reduce((sum, s) => sum + s.dur, 0);
