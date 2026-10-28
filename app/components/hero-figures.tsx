// Decorative figures for the blue start screen: a graduation cap, a euro coin,
// an open book, a deadline calendar, a paper plane and a few sparkles. They are
// hidden from assistive technology, never take pointer input, and sit beside
// the text on wide screens or in one small row under it on narrow ones.
const NAVY = "#0E1638";
const NAVY_SOFT = "#1B2A6B";
const YELLOW = "#FFD62E";
const YELLOW_DEEP = "#E8B800";
const SKY = "#C9D3FF";
const SKY_DEEP = "#A9B8FF";

function Cap({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 160 118" focusable="false">
    <path d="M42 50v26c0 11 17 20 38 20s38-9 38-20V50L80 66z" fill={NAVY_SOFT} />
    <path d="M80 10l70 30-70 30-70-30z" fill={NAVY} />
    <path d="M80 40l50 12v32" fill="none" stroke={YELLOW} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="123" y="80" width="14" height="22" rx="5" fill={YELLOW} />
    <circle cx="80" cy="40" r="6" fill={YELLOW} />
  </svg>;
}

function Coin({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 120 120" focusable="false">
    <circle cx="60" cy="60" r="56" fill={YELLOW} />
    <circle cx="60" cy="60" r="44" fill="none" stroke={YELLOW_DEEP} strokeWidth="5" />
    <path d="M77 41a26 26 0 1 0 0 38" fill="none" stroke={NAVY} strokeWidth="9" strokeLinecap="round" />
    <path d="M34 54h34M34 67h30" stroke={NAVY} strokeWidth="8" strokeLinecap="round" />
  </svg>;
}

function Book({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 160 112" focusable="false">
    <path d="M6 28v76c28-8 52-6 74 6 22-12 46-14 74-6V28" fill={NAVY} />
    <path d="M80 22c-20-12-46-13-68-6v76c22-7 48-6 68 6z" fill="#FFFFFF" />
    <path d="M80 22c20-12 46-13 68-6v76c-22-7-48-6-68 6z" fill="#FFFFFF" />
    <path d="M80 22v76" stroke={SKY} strokeWidth="4" />
    <path d="M26 38c13-4 28-4 40 1M26 52c13-4 28-4 40 1M26 66c13-4 28-4 40 1M94 39c12-5 27-5 40-1M94 53c12-5 27-5 40-1M94 67c12-5 27-5 40-1" fill="none" stroke={SKY_DEEP} strokeWidth="5" strokeLinecap="round" />
  </svg>;
}

function Calendar({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 110 120" focusable="false">
    <rect x="8" y="16" width="94" height="96" rx="18" fill="#FFFFFF" />
    <path d="M8 34a18 18 0 0 1 18-18h58a18 18 0 0 1 18 18v12H8z" fill={NAVY} />
    <rect x="28" y="4" width="10" height="24" rx="5" fill={SKY} />
    <rect x="72" y="4" width="10" height="24" rx="5" fill={SKY} />
    <path d="M32 78l15 15 31-32" fill="none" stroke="#4660FF" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function Plane({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 150 100" focusable="false">
    <path d="M10 92c18-4 30-10 40-20" fill="none" stroke="#FFFFFF" strokeOpacity=".55" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" />
    <path d="M38 52L144 8 110 90 86 64z" fill="#FFFFFF" />
    <path d="M86 64L144 8 70 58z" fill={SKY} />
    <path d="M86 64l-4 24 14-14" fill={SKY_DEEP} />
  </svg>;
}

function Sparkle({ className, color = "#FFFFFF" }: { className?: string; color?: string }) {
  return <svg className={className} viewBox="0 0 24 24" focusable="false">
    <path d="M12 0c1.4 7.2 4.8 10.6 12 12-7.2 1.4-10.6 4.8-12 12C10.6 16.8 7.2 13.4 0 12 7.2 10.6 10.6 7.2 12 0z" fill={color} />
  </svg>;
}

// Wide screens: figures in the space left and right of the text column.
export function HeroFigures() {
  return <div className="hero-figures" aria-hidden="true">
    <Calendar className="fig fig-calendar" />
    <Book className="fig fig-book" />
    <Cap className="fig fig-cap" />
    <Coin className="fig fig-coin" />
    <Plane className="fig fig-plane" />
    <Sparkle className="fig spark spark-1" />
    <Sparkle className="fig spark spark-2" color={YELLOW} />
    <Sparkle className="fig spark spark-3" />
    <Sparkle className="fig spark spark-4" color={YELLOW} />
    <Sparkle className="fig spark spark-5" />
  </div>;
}

// Narrow screens: one small row under the text, so nothing covers it.
export function HeroFiguresRow() {
  return <div className="hero-figures-row" aria-hidden="true">
    <Cap className="row-cap" />
    <Coin className="row-coin" />
    <Book className="row-book" />
    <Sparkle className="row-spark" color={YELLOW} />
    <Plane className="row-plane" />
  </div>;
}
