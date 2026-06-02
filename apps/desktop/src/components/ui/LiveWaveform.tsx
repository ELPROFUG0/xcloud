import { useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/cn";

interface LiveWaveformProps {
  active: boolean;
  deviceId?: string;
  height?: number;
  barWidth?: number;
  barGap?: number;
  barRadius?: number;
  barColor?: string;
  sensitivity?: number;
  fadeEdges?: boolean;
  fadeWidth?: number;
  className?: string;
}

export function LiveWaveform({
  active,
  deviceId,
  height = 24,
  barWidth = 4,
  barGap = 2,
  barRadius = 2,
  barColor = "rgba(119, 119, 119, 0.6)",
  sensitivity = 1.2,
  fadeEdges = true,
  fadeWidth = 20,
  className,
}: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const historyRef = useRef<number[]>([]);
  const lastUpdateRef = useRef<number>(0);

  const stop = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = 0;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    historyRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => {
    if (!active) { stop(); return; }
    let cancelled = false;

    async function start() {
      try {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices?.getUserMedia) return;
        const stream = await mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;
        const audioCtx = new AudioContext();
        ctxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        analyser.minDecibels = -80;
        analyser.maxDecibels = -10;
        source.connect(analyser);
        analyserRef.current = analyser;

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const timeData = new Uint8Array(analyser.fftSize);
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        // Setup canvas size
        const setupCanvas = () => {
          const rect = container.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          canvas.width = rect.width * dpr;
          canvas.height = rect.height * dpr;
          canvas.style.width = `${rect.width}px`;
          canvas.style.height = `${rect.height}px`;
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.scale(dpr, dpr);
        };
        setupCanvas();

        const resizeObs = new ResizeObserver(setupCanvas);
        resizeObs.observe(container);

        const draw = (currentTime: number) => {
          if (cancelled || !analyserRef.current) return;
          animRef.current = requestAnimationFrame(draw);

          // Sample audio at ~50fps
          if (currentTime - lastUpdateRef.current > 20) {
            lastUpdateRef.current = currentTime;
            analyserRef.current.getByteFrequencyData(freqData);
            analyserRef.current.getByteTimeDomainData(timeData);

            // Frequency energy (bass + mid emphasis)
            let freqSum = 0;
            const usefulBins = Math.floor(freqData.length * 0.5);
            for (let i = 0; i < usefulBins; i++) freqSum += freqData[i]!;
            const freqAvg = freqSum / usefulBins / 255;

            // Time domain RMS (actual volume)
            let rmsSum = 0;
            for (let i = 0; i < timeData.length; i++) {
              const v = (timeData[i]! - 128) / 128;
              rmsSum += v * v;
            }
            const rms = Math.sqrt(rmsSum / timeData.length);

            // Combine both signals
            const combined = (freqAvg * 0.6 + rms * 2.5 * 0.4) * sensitivity;
            historyRef.current.push(Math.min(1, Math.max(0.04, combined)));
            // Keep history bounded
            const rect = container.getBoundingClientRect();
            const maxBars = Math.ceil(rect.width / (barWidth + barGap)) + 10;
            if (historyRef.current.length > maxBars) historyRef.current.shift();
          }

          const rect = container.getBoundingClientRect();
          const w = rect.width;
          const h = rect.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.clearRect(0, 0, w, h);

          const step = barWidth + barGap;
          const barsVisible = Math.floor(w / step);
          const centerY = h / 2;
          const data = historyRef.current;

          // Draw bars from right to left (newest on right)
          for (let i = 0; i < barsVisible && i < data.length; i++) {
            const val = data[data.length - 1 - i] ?? 0.05;
            const barH = Math.max(3, val * h * 0.8);
            const x = w - (i + 1) * step;
            const y = centerY - barH / 2;

            ctx.fillStyle = barColor;
            ctx.globalAlpha = 0.35 + val * 0.65;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barH, barRadius);
            ctx.fill();
          }

          // Fade edges
          if (fadeEdges && fadeWidth > 0) {
            const gradient = ctx.createLinearGradient(0, 0, w, 0);
            const fp = Math.min(0.15, fadeWidth / w);
            gradient.addColorStop(0, "rgba(255,255,255,1)");
            gradient.addColorStop(fp, "rgba(255,255,255,0)");
            gradient.addColorStop(1 - fp, "rgba(255,255,255,0)");
            gradient.addColorStop(1, "rgba(255,255,255,1)");
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = "source-over";
          }

          ctx.globalAlpha = 1;
        };

        animRef.current = requestAnimationFrame(draw);

        return () => { resizeObs.disconnect(); };
      } catch {
        // Mic denied
      }
    }

    const cleanup = start();
    return () => { cancelled = true; cleanup?.then(fn => fn?.()); stop(); };
  }, [active, deviceId, stop, barWidth, barGap, barRadius, barColor, sensitivity, fadeEdges, fadeWidth]);

  return (
    <div ref={containerRef} className={cn("relative", className)} style={{ height }}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
