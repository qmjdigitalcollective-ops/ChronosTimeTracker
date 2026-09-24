import { Injectable, signal } from '@angular/core';

declare global {
  interface Window {
    electronAPI?: {
      captureScreen: () => Promise<string>;
      isElectron: boolean;
    };
  }
}

@Injectable({
  providedIn: 'root',
})
export class ScreenshotService {
  private mediaStream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;

  readonly isSharing = signal<boolean>(false);
  readonly lastCapturedUrl = signal<string | null>(null);
  readonly lastCapturedTime = signal<number | null>(null);
  readonly captureError = signal<string | null>(null);
  readonly isSimulated = signal<boolean>(false);
  readonly isElectron = signal<boolean>(false);

  constructor() {
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      this.isElectron.set(true);
      this.isSharing.set(true);
    } else if (typeof document !== 'undefined') {
      this.videoElement = document.createElement('video');
      this.videoElement.autoplay = true;
      this.videoElement.muted = true;
      this.videoElement.playsInline = true;
    }
  }

  /**
   * In Electron: Screen capture has full OS background access, no prompt required!
   * In Browser: Prompts once via getDisplayMedia if available.
   */
  async requestScreenPermission(): Promise<boolean> {
    this.captureError.set(null);

    // If running in desktop Electron app, background screen capture is automatically granted
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      this.isSharing.set(true);
      this.isSimulated.set(false);
      return true;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      this.isSimulated.set(true);
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        } as MediaTrackConstraints,
        audio: false,
      });

      this.mediaStream = stream;
      if (this.videoElement) {
        this.videoElement.srcObject = stream;
        await this.videoElement.play().catch(() => {});
      }

      this.isSharing.set(true);
      this.isSimulated.set(false);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          this.isSharing.set(false);
          this.mediaStream = null;
        };
      }

      return true;
    } catch (err: unknown) {
      // If user cancels browser prompt, fall back to background simulated telemetry snapshots
      this.isSimulated.set(true);
      return false;
    }
  }

  stopScreenCapture(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    if (!this.isElectron()) {
      this.isSharing.set(false);
    }
  }

  /**
   * Captures screen silently in background.
   */
  async captureFrame(meta: {
    employeeName: string;
    clientName: string;
    taskDescription: string;
  }): Promise<{ full: string; thumb: string }> {
    // 1. Native Electron Silent Capture
    if (typeof window !== 'undefined' && window.electronAPI?.captureScreen) {
      try {
        const rawBase64 = await window.electronAPI.captureScreen();
        if (rawBase64) {
          const fullJpeg = rawBase64.startsWith('data:') ? rawBase64 : `data:image/jpeg;base64,${rawBase64}`;
          const now = Date.now();
          this.lastCapturedUrl.set(fullJpeg);
          this.lastCapturedTime.set(now);
          return { full: fullJpeg, thumb: fullJpeg };
        }
      } catch (e) {
        console.error('Electron silent capture error:', e);
      }
    }

    // 2. Browser Stream Capture
    if (this.isSharing() && this.videoElement && this.videoElement.videoWidth > 0) {
      try {
        const width = this.videoElement.videoWidth;
        const height = this.videoElement.videoHeight;
        const scale = Math.min(1, 1280 / width);
        const canvasWidth = Math.round(width * scale);
        const canvasHeight = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          ctx.drawImage(this.videoElement, 0, 0, canvasWidth, canvasHeight);
          this.drawWatermark(ctx, canvasWidth, canvasHeight, meta);

          const fullJpeg = canvas.toDataURL('image/jpeg', 0.75);
          const thumbScale = Math.min(1, 320 / canvasWidth);
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = Math.round(canvasWidth * thumbScale);
          thumbCanvas.height = Math.round(canvasHeight * thumbScale);
          const thumbCtx = thumbCanvas.getContext('2d');
          if (thumbCtx) {
            thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
          }
          const thumbJpeg = thumbCanvas.toDataURL('image/jpeg', 0.65);

          const now = Date.now();
          this.lastCapturedUrl.set(fullJpeg);
          this.lastCapturedTime.set(now);

          return { full: fullJpeg, thumb: thumbJpeg };
        }
      } catch (e) {
        console.error('Canvas capture error:', e);
      }
    }

    // 3. Resilient Fallback Snapshot
    return this.generateSimulatedScreenshot(meta);
  }

  private drawWatermark(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    meta: { employeeName: string; clientName: string; taskDescription: string }
  ): void {
    const barHeight = 28;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, h - barHeight, w, barHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    const timestampStr = new Date().toLocaleString();
    const text = `${timestampStr} | ${meta.employeeName} | ${meta.clientName} | ${meta.taskDescription}`;
    ctx.fillText(text, 14, h - barHeight / 2);
  }

  private generateSimulatedScreenshot(meta: {
    employeeName: string;
    clientName: string;
    taskDescription: string;
  }): { full: string; thumb: string } {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');

    if (!ctx) return { full: '', thumb: '' };

    const grad = ctx.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e293b');
    grad.addColorStop(1, '#334155');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(80, 60, 1120, 600, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(80, 60, 1120, 48, [12, 12, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 20px Inter, system-ui, sans-serif';
    ctx.fillText(`Desktop Session - ${meta.employeeName}`, 120, 160);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '15px Inter, system-ui, sans-serif';
    ctx.fillText(`Client: ${meta.clientName}`, 120, 200);
    ctx.fillText(`Task: ${meta.taskDescription}`, 120, 230);
    ctx.fillText(`Timestamp: ${new Date().toLocaleString()}`, 120, 260);

    this.drawWatermark(ctx, 1280, 720, meta);

    const fullJpeg = canvas.toDataURL('image/jpeg', 0.75);
    return { full: fullJpeg, thumb: fullJpeg };
  }
}
