import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../lib/icons";
import { useT } from "../lib/i18n";

/**
 * A small "(?)" help affordance placed next to a control. Hovering it for a
 * beat pops a dead-simple, plain-language explanation (aimed at someone who
 * has never seen the app); clicking it jumps to the full topic in /help.
 *
 * Delay is 500ms — long enough not to fire on an accidental pass-over, short
 * enough that people actually wait for it (2s, the first instinct, is long
 * enough that most give up before it shows).
 *
 * `id` should match a Help entry id (see lib/helpContent.ts) so the click-
 * through lands on the right section.
 */
const HOVER_DELAY_MS = 500;

export function HelpHint({
  id,
  title,
  children,
}: {
  id?: string;
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function scheduleOpen() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  }
  function close() {
    window.clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <span className="help-hint" onMouseEnter={scheduleOpen} onMouseLeave={close}>
      <button
        type="button"
        className="help-hint-btn"
        aria-label={title ? `Help: ${title}` : "Help"}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={() => id && navigate(`/help#${id}`)}
      >
        <Icon.help width={13} height={13} />
      </button>
      {open && (
        <span className="help-hint-pop" role="tooltip">
          {title && <span className="help-hint-title">{title}</span>}
          <span className="help-hint-body">{children}</span>
          {id && <span className="help-hint-more">{t("help.readMore")}</span>}
        </span>
      )}
    </span>
  );
}
