// Small stroke icons; every one is decorative, so the control around it carries the label.
const Stroke = ({ d, width = 2.2 }: { d: string; width?: number }) =>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={d} /></svg>;

export const BookmarkIcon = ({ filled = false }: { filled?: boolean }) =>
  <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>;
export const ExternalIcon = () => <Stroke d="M7 17 17 7M8 7h9v9" />;
export const BackIcon = () => <Stroke d="M15 6l-6 6 6 6" />;
export const DownIcon = () => <Stroke d="M12 5v14M6 13l6 6 6-6" />;
export const SendIcon = () => <Stroke d="M12 19V5M6 11l6-6 6 6" />;
export const EditIcon = () => <Stroke d="M4 20h4L19 9l-4-4L4 16z" />;
export const CheckIcon = () => <Stroke d="M5 12.5l4.5 4.5L19 7.5" width={3} />;
export const CrossIcon = () => <Stroke d="M6 6l12 12M18 6 6 18" width={3} />;
export const ChevronIcon = ({ open }: { open: boolean }) => <Stroke d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />;

// The Scholarable mark from public/scholarable-mark.svg, inline so it takes the text colour.
export const LogoMark = ({ className = "logo-mark" }: { className?: string }) =>
  <svg className={className} viewBox="280 275 485 475" aria-hidden="true" focusable="false">
    <path d="M439.814 424.711C453.299 423.156 470.27 425.153 484.09 424.326C493.907 423.739 503.07 424.157 510.656 431.284C515.542 435.79 518.385 442.089 518.533 448.735C518.817 460.408 512.474 465.838 505.375 473.571C478.297 503.071 446.78 522.385 441.719 565.193C438.877 589.123 445.662 613.201 460.579 632.127C466.01 638.966 472.787 645.299 478.979 651.51L503.394 675.898C511.546 684.033 520.229 691.41 520.42 703.979C520.53 711.204 517.639 718.7 512.502 723.808C509.248 727.031 505.189 729.322 500.749 730.444C493.968 732.209 467.17 731.41 458.244 731.372C418.786 731.157 382.651 719.782 352.404 693.814C321.774 667.376 302.861 629.883 299.8 589.537C296.667 546.732 309.023 508.462 337.13 476.061C363.069 445.843 400.077 427.336 439.814 424.711Z" />
    <path d="M538.45 294.242C579.758 293.74 609.406 292.689 647.078 313.619C682.313 333.277 708.395 366.013 719.686 404.749C743.855 489.613 694.887 571.703 611.025 595.293C588.655 601.538 565.676 599.808 542.758 600.082C537.746 600.141 531.395 600.301 526.535 599.264C522.043 598.266 517.89 596.109 514.492 593.006C509.769 588.602 507.01 582.487 506.833 576.032C506.292 560.938 516.925 554.625 526.224 544.992C552.207 518.079 578.975 499.627 583.852 459.649C586.736 435.726 579.883 411.648 564.836 392.828C559.385 385.876 551.768 378.656 545.565 372.33C538.381 365.002 531.023 357.717 523.788 350.442C514.875 341.48 505.396 335.266 505.052 321.251C504.835 314.224 507.439 307.403 512.283 302.308C520.074 294.208 528.332 294.37 538.45 294.242Z" />
  </svg>;
