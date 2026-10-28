// Small line icons (24×24, drawn with the text colour), the same on every device – emoji look
// different on each system and come in different sizes.

import type { JSX } from 'preact';

const PATHS: Record<string, JSX.Element> = {
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  open: <><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4" /><path d="M12 11v6M9 14h6" /></>,
  sheets: <><path d="M8 3h9l3 3v13H8z" /><path d="M5 7v14h11" /></>,
  settings: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  note: <><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
  scroll: <><path d="M7 5l5 5 5-5" /><path d="M7 13l5 5 5-5" /></>,
  play: <path d="M7 4l13 8-13 8z" class="filled" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" class="filled" />,
  pause: <><rect x="6" y="5" width="4" height="14" class="filled" /><rect x="14" y="5" width="4" height="14" class="filled" /></>,
  top: <><path d="M5 4h14" /><path d="M12 20V8" /><path d="M7 13l5-5 5 5" /></>,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  warn: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  sync: <><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" /><path d="M18 3v4h-4M6 21v-4h4" /></>,
  sortName: <><path d="M4 18l3.5-10L11 18M5.2 15h4.6" /><path d="M14 8h6l-6 10h6" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  text: <><path d="M5 5h14M12 5v14" /><path d="M9 19h6" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName }) {
  return (
    <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[props.name]}
    </svg>
  );
}

/**
 * A button with an icon and a label. On a small screen only the icon is shown; the label is
 * then the tooltip (mouse) and what a screen reader reads.
 */
export function IconButton(props: {
  icon: IconName;
  label: string;
  onClick?: (e: MouseEvent) => void;
  class?: string;
  disabled?: boolean;
  /** Keep the label even on a small screen. */
  keepLabel?: boolean;
  /** Never show the label (only as tooltip). */
  iconOnly?: boolean;
}) {
  const kind = props.keepLabel ? ' keep' : props.iconOnly ? ' only' : '';
  return (
    <button
      class={'ib' + kind + (props.class ? ' ' + props.class : '')}
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
      {!props.iconOnly && <span class="ib-label">{props.label}</span>}
    </button>
  );
}
