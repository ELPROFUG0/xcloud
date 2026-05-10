import { useEffect, useMemo, useRef, useState } from "react";
import "@/components/dotmatrix-loader.css";

interface XCloudDotLogoProps {
  size?: number;
  cells?: number;
  dotSize?: number;
  speed?: number;
  color?: string;
  animated?: boolean;
  className?: string;
}

const VIEWBOX_SIZE = 1024;
const LOGO_PATHS = [
  "M971.28,491.38c-3.15-57.18-13.51-114.3-33.71-168.07-23.41-62.3-60.53-119.09-110.76-163.02-2.56-2.3-4.66-4-5.84-5.05-20.39-17.25-72.53-58.23-141.78-82.04-114.76-39.54-219.55-12.39-240.8-6.49-68.07,18.82-113.12,50.56-144.4,72.99-109.19,78.36-159.35,175.94-184.53,226.37-49.12,98.3-55.09,170.7-56.27,187.16-2.1,30.82-4.26,66.04,10.03,108.46,7.48,22.17,33.77,100.33,107.42,124.6,40.85,13.38,78.04,4.2,95.55-1.44.59,5.05,1.57,12.2,3.08,20.72,1.77,10.23,6.36,36.2,15.21,58.76,4.59,11.74,17.64,43.81,49.77,70.69,8.66,7.28,30.76,25.38,64.59,33.18,47.61,11.08,86.69-5.51,106.83-14.03,43.54-18.49,70.56-47.48,84.14-64.66,4,5.64,9.64,12.66,17.05,20,3.8,3.8,13.77,13.25,28.92,22.49,6.49,3.93,18.36,11.02,34.95,15.94,21.51,6.36,39.15,5.64,48.07,5.11,42.43-2.23,75.81-21.97,90.43-30.82,62.1-37.64,91.87-92.53,106.17-119.61,3.48-6.56,15.54-28,26.95-66.89,23.08-78.69,33.44-162.76,28.92-244.34ZM923.87,632.56c-9.18,63.94-25.58,103.61-29.31,112.4-4.39,10.43-9.25,20.66-14.56,30.62-32.33,60.92-77.32,117.06-148.07,133.84-24.53,5.84-49.71,1.25-70.89-12.39-17.97-11.61-32.13-28.33-43.22-46.63-3.74-6.23-7.34-12.79-13.12-17.12-9.71-7.35-21.12-3.15-28.85,4.79-8.98,9.12-16.26,19.94-25.25,29.18-9.05,9.31-18.69,18.1-28.99,26.03-17.05,13.12-36.2,24.53-56.99,30.49-11.8,3.48-21.05,3.8-23.08,3.87-23.74,1.44-42.69-5.11-53.51-9.97-4-1.84-17.64-8.66-31.74-23.08-34.62-35.48-46.49-81.78-47.41-129.91-.2-10.62-1.25-23.08-10.23-28.92-7.02-4.59-16.39-3.15-24.2,0-13.9,5.51-26.3,10.75-41.18,13.12-21.58,3.41-43.94,1.38-63.81-7.93-43.54-20.26-58.1-65.77-66.56-93.91-31.94-105.71,17.51-208.21,43.67-262.51,34.69-71.81,77.12-118.83,98.37-142.04,25.64-28,54.17-59.28,99.22-87.48,115.87-72.66,269.19-79.74,389.14-12.46,121.97,68.4,183.22,204.93,194.04,339.76,4,49.9,3.67,100.6-3.48,150.24Z",
  "M557.48,507.11c-29.79,6.17-60.85-14.22-80.44-48.97,2.41.54,4.96.8,7.51.8,24.35,0,44.08-23.75,44.08-53.06s-19.72-53-44.08-53c-9.93,0-19.05,3.89-26.43,10.6,4.63-38.31,24.75-68.23,53.87-74.33,40.99-8.59,84.46,33.27,97.01,93.45,12.54,60.18-10.53,115.92-51.52,124.51Z",
  "M747.95,463.01c-29.79,6.17-60.85-14.22-80.44-48.97,2.41.54,4.96.8,7.51.8,24.35,0,44.08-23.75,44.08-53.06s-19.72-53-44.08-53c-9.93,0-19.05,3.89-26.43,10.6,4.63-38.31,24.75-68.23,53.87-74.33,40.99-8.59,84.46,33.27,97.01,93.45,12.54,60.18-10.53,115.92-51.52,124.51Z",
];

export function XCloudDotLogo({
  size = 96,
  cells = 18,
  dotSize = 3,
  speed = 1,
  color = "#FFFFFF",
  animated = true,
  className,
}: XCloudDotLogoProps) {
  const resolvedCells = Math.max(8, Math.round(cells));
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRefs = useRef<Array<SVGPathElement | null>>([]);
  const [activeDots, setActiveDots] = useState<Set<number> | null>(null);

  const dots = useMemo(() => {
    const step = VIEWBOX_SIZE / resolvedCells;
    return Array.from({ length: resolvedCells * resolvedCells }, (_, index) => {
      const row = Math.floor(index / resolvedCells);
      const col = index % resolvedCells;
      const diagonalOrder = row + col;
      return {
        index,
        diagonalOrder,
        x: col * step + step / 2,
        y: row * step + step / 2,
      };
    });
  }, [resolvedCells]);

  const safeSpeed = speed > 0 ? speed : 1;
  const viewBoxDotSize = (dotSize / size) * VIEWBOX_SIZE;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const next = new Set<number>();
    for (const dot of dots) {
      const point = svg.createSVGPoint();
      point.x = dot.x;
      point.y = dot.y;
      if (pathRefs.current.some((path) => path?.isPointInFill(point))) {
        next.add(dot.index);
      }
    }
    setActiveDots(next);
  }, [dots]);

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="xCloud dot logo"
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      width={size}
      height={size}
      className={["dmx-xcloud-dot-logo", className].filter(Boolean).join(" ")}
      style={{
        color,
        ["--dmx-speed" as string]: 1 / safeSpeed,
        ["--dmx-cycle" as string]: "1650ms",
        ["--dmx-dot-size" as string]: `${dotSize}px`,
        ["--dmx-opacity-base" as string]: 0.12,
        ["--dmx-opacity-mid" as string]: 0.46,
        ["--dmx-opacity-peak" as string]: 1,
      }}
    >
      <g opacity="0" pointerEvents="none">
        {LOGO_PATHS.map((path, index) => (
          <path
            key={path}
            ref={(node) => { pathRefs.current[index] = node; }}
            d={path}
            fill="black"
          />
        ))}
      </g>
      {dots.map((dot) => {
        const visible = activeDots?.has(dot.index) ?? true;
        if (!visible) return null;
        return (
          <circle
            key={dot.index}
            aria-hidden="true"
            className={animated ? "dmx-dot dmx-xcloud-diagonal" : "dmx-dot"}
            cx={dot.x}
            cy={dot.y}
            r={viewBoxDotSize / 2}
            fill="currentColor"
            style={{
              ["--dmx-diagonal-snake-order" as string]: dot.diagonalOrder,
              ...(animated ? undefined : { opacity: 0.78 }),
            }}
          />
        );
      })}
    </svg>
  );
}
