export interface DailyCount {
  /** UTC calendar day as `YYYY-MM-DD`. */
  day: string
  count: number
}

interface MiniBarChartProps {
  data: DailyCount[]
  label: string
}

const VIEWBOX_WIDTH = 100
const VIEWBOX_HEIGHT = 32
const BAR_GAP = 0.6
/** Keeps empty days visible as a faint stub instead of a zero-height rect. */
const MIN_BAR_HEIGHT = 0.75

function formatDay(day: string) {
  const [, month, date] = day.split("-")
  return `${month}/${date}`
}

/**
 * Dependency-free daily bar chart. Pure SVG with no client-side JS so it can be
 * rendered straight from a server component; bars are scaled to the window's
 * peak, and an all-zero window falls back to flat stubs rather than NaN heights.
 */
export function MiniBarChart({ data, label }: MiniBarChartProps) {
  const total = data.reduce((sum, point) => sum + point.count, 0)
  const max = data.reduce((peak, point) => Math.max(peak, point.count), 0)
  const peak = data.reduce<DailyCount | null>(
    (best, point) => (best === null || point.count > best.count ? point : best),
    null
  )

  const slot = data.length > 0 ? VIEWBOX_WIDTH / data.length : VIEWBOX_WIDTH
  const barWidth = Math.max(slot - BAR_GAP, 0.5)

  const ariaLabel =
    peak && max > 0
      ? `${label}: ${total} total over the last ${data.length} days, peaking at ${peak.count} on ${peak.day}.`
      : `${label}: no activity in the last ${data.length} days.`

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {total.toLocaleString()} in {data.length}d
        </p>
      </div>

      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-20 w-full"
      >
        {data.map((point, index) => {
          const height =
            max > 0
              ? Math.max((point.count / max) * VIEWBOX_HEIGHT, MIN_BAR_HEIGHT)
              : MIN_BAR_HEIGHT
          return (
            <rect
              key={point.day}
              x={index * slot}
              y={VIEWBOX_HEIGHT - height}
              width={barWidth}
              height={height}
              rx={0.5}
              className={
                point.count > 0 ? "fill-brand-500" : "fill-muted-foreground/30"
              }
            />
          )
        })}
      </svg>

      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{data.length > 0 ? formatDay(data[0].day) : ""}</span>
        <span>{data.length > 0 ? formatDay(data[data.length - 1].day) : ""}</span>
      </div>
    </div>
  )
}
