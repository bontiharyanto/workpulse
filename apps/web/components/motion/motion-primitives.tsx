'use client';

import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type HTMLMotionProps,
  type Variants,
} from 'framer-motion';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

/**
 * Motion tokens — subtle by design. Notion / Linear tier.
 *
 * Every primitive here must:
 *   1. Respect `prefers-reduced-motion` — degrade to a plain
 *      render, never fake the reduce with a shortened animation.
 *   2. Complete in <= 240ms — user should not perceive the app
 *      as "waiting on animations".
 *   3. Use a single ease curve (`easeOutQuart`) so the whole app
 *      feels coherent. Framer's default is spring-y; we replace it
 *      to match the visual language.
 */

// cubic-bezier(0.16, 1, 0.3, 1) — easeOutQuart — decelerates gently
// which reads as "settling in" (Notion / Linear standard).
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const DURATION = 0.22;

// ---------------------------------------------------------------------------
// FadeIn
// ---------------------------------------------------------------------------

interface FadeInProps {
  children: ReactNode;
  /** Extra delay in seconds. Default 0. */
  delay?: number;
  /** Amount of vertical translation on enter, in pixels. Default 8. */
  y?: number;
  className?: string;
}

/**
 * Wrap a section that should fade + rise slightly on mount.
 * Zero-cost fallback when the user prefers reduced motion —
 * renders a plain div so no motion runtime cost is paid.
 */
export function FadeIn({ children, delay = 0, y = 8, className }: FadeInProps): JSX.Element {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION, ease: EASE_OUT, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// StaggerList / StaggerItem
// ---------------------------------------------------------------------------

const staggerParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
};

const staggerChild: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION, ease: EASE_OUT } },
};

interface StaggerListProps extends HTMLMotionProps<'ul'> {
  children: ReactNode;
}

/**
 * Parent list that staggers its direct children. Use with
 * `StaggerItem` for `<li>` children. Falls back to a plain `<ul>`
 * when reduced motion is preferred.
 */
export function StaggerList({ children, className, ...props }: StaggerListProps): JSX.Element {
  const reduce = useReducedMotion();
  if (reduce) {
    return <ul className={className}>{children}</ul>;
  }
  return (
    <motion.ul
      initial="hidden"
      animate="visible"
      variants={staggerParent}
      className={className}
      {...props}
    >
      {children}
    </motion.ul>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const reduce = useReducedMotion();
  if (reduce) return <li className={className}>{children}</li>;
  return (
    <motion.li variants={staggerChild} className={className}>
      {children}
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// CountUp
// ---------------------------------------------------------------------------

interface CountUpProps {
  /** Target value to animate to. */
  value: number;
  /** Duration in seconds. Default 0.8. */
  duration?: number;
  /** How many decimals to render. Default 0. */
  decimals?: number;
  /** Custom formatter — takes the rendered number, returns a string. */
  format?: (n: number) => string;
  /** Waits until the element scrolls into view before animating. */
  runWhenInView?: boolean;
  className?: string;
}

/**
 * Counts from 0 up to `value` on mount (or when scrolled into view).
 * Backed by a spring so the last frames decelerate naturally rather
 * than snapping. Falls back to the final value immediately under
 * reduced motion.
 *
 * ```tsx
 *   <CountUp value={1234} format={(n) => n.toLocaleString('id-ID')} />
 * ```
 */
export function CountUp({
  value,
  duration = 0.8,
  decimals = 0,
  format,
  runWhenInView = false,
  className,
}: CountUpProps): JSX.Element {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });

  const motionValue = useMotionValue(0);
  // Stiffness / damping tuned so `duration` lines up empirically —
  // spring physics is not fixed-duration, so this is a best-effort.
  const spring = useSpring(motionValue, {
    stiffness: 60,
    damping: 15,
    duration: duration * 1000,
  });
  const rounded = useTransform(spring, (v) => (format ? format(v) : v.toFixed(decimals)));

  const finalDisplay = format ? format(value) : value.toFixed(decimals);
  const [displayed, setDisplayed] = useState<string>(() =>
    format ? format(0) : (0).toFixed(decimals),
  );

  useEffect(() => {
    if (reduce) {
      setDisplayed(finalDisplay);
      return;
    }
    if (runWhenInView && !inView) return;
    motionValue.set(value);
  }, [value, finalDisplay, motionValue, reduce, runWhenInView, inView]);

  useEffect(() => {
    return rounded.on('change', (next) => setDisplayed(String(next)));
  }, [rounded]);

  // `data-value` exposes the final numeric target regardless of where
  // the count-up animation currently is. E2E tests should read this
  // instead of the (potentially mid-animation) text content.
  return (
    <span ref={ref} className={className} data-value={value} data-final={finalDisplay}>
      {displayed}
    </span>
  );
}

// ---------------------------------------------------------------------------
// HoverLift
// ---------------------------------------------------------------------------

interface HoverLiftProps {
  children: ReactElement;
  /** Pixels of Y translation on hover. Default -2. */
  y?: number;
  /** Milliseconds. Default 150. */
  duration?: number;
}

/**
 * Wraps a single child element and lifts it a couple pixels on
 * hover — the standard "interactive card" hint. Requires the child
 * to accept `style` and `onMouseEnter` / `onMouseLeave`. Reduced
 * motion returns the child untouched.
 *
 * We do NOT use `motion.div` here because the whole point is to
 * layer on TOP of an existing Shadcn primitive (Card, Button as
 * link, etc.) without inserting an extra wrapper into the DOM.
 */
export function HoverLift({ children, y = -2, duration = 150 }: HoverLiftProps): JSX.Element {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);

  if (reduce || !isValidElement(children)) return <>{children}</>;

  const existing = children.props as {
    style?: React.CSSProperties;
    onMouseEnter?: React.MouseEventHandler;
    onMouseLeave?: React.MouseEventHandler;
  };

  return cloneElement(children, {
    style: {
      ...existing.style,
      transform: hovered ? `translateY(${y}px)` : 'translateY(0)',
      transition: `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
      willChange: 'transform',
    },
    onMouseEnter: (e: React.MouseEvent) => {
      setHovered(true);
      existing.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      setHovered(false);
      existing.onMouseLeave?.(e);
    },
  } as never);
}

// ---------------------------------------------------------------------------
// PageTransition
// ---------------------------------------------------------------------------

/**
 * Route-level fade-in wrapper. Mount at the top of every page
 * (or in a layout that has access to `usePathname()`) inside an
 * `<AnimatePresence mode="wait">` for exit animations too. Kept
 * intentionally cheap — a single opacity + Y transform. No layout
 * shift, no re-parenting of DOM.
 */
export function PageTransition({
  children,
  routeKey,
}: {
  children: ReactNode;
  /** Pathname or unique identifier for the current route. */
  routeKey: string;
}): JSX.Element {
  const reduce = useReducedMotion();

  if (reduce) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: DURATION, ease: EASE_OUT }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// AnimatedNumberDelta — sign-aware count-up (used by KPI cards)
// ---------------------------------------------------------------------------

/**
 * Renders a numeric delta with automatic +/- sign and semantic
 * color. Positive deltas render as `success`, negative as
 * `destructive`, zero as `muted-foreground`. Non-animated variant
 * of CountUp for compact use.
 */
export function DeltaLabel({
  value,
  suffix = '',
  className,
}: {
  value: number;
  suffix?: string;
  className?: string;
}): JSX.Element {
  const sign = value > 0 ? '+' : value < 0 ? '' : '±';
  const color =
    value > 0 ? 'text-success' : value < 0 ? 'text-destructive' : 'text-muted-foreground';
  return (
    <span className={cn('font-numeric text-xs font-medium tabular-nums', color, className)}>
      {sign}
      {value.toLocaleString('id-ID')}
      {suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ambient exports (re-export select framer bits so callers don't have
// to import from two places)
// ---------------------------------------------------------------------------

export { AnimatePresence, motion, useReducedMotion, Children };
