import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { X, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Full-screen camera overlay that scans for a QR code and returns its text.
 * Uses getUserMedia + jsQR (offline, pure JS). On macOS this needs the app's
 * camera permission (NSCameraUsageDescription) and a webview that grants media
 * capture; if either is missing, getUserMedia rejects and we show a clear error.
 */
export function QrScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const scan = () => {
      const video = videoRef.current;
      if (!doneRef.current && video && video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (found?.data) {
          doneRef.current = true;
          onCode(found.data.trim());
          return;
        }
      }
      raf = requestAnimationFrame(scan);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        raf = requestAnimationFrame(scan);
      } catch (e) {
        const name = (e as Error)?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was denied. Enable it in System Settings → Privacy & Security → Camera.'
            : name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'Could not open the camera on this device.',
        );
      }
    })();

    return () => {
      doneRef.current = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm">
      <button
        onClick={onClose}
        aria-label="Close scanner"
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X size={18} />
      </button>

      {error ? (
        <div className="mx-6 max-w-[360px] rounded-[16px] bg-card p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <Camera size={22} />
          </div>
          <div className="font-heading text-lg font-semibold">Camera unavailable</div>
          <div className="mt-1.5 text-[13px] text-muted-foreground">{error}</div>
          <Button className="mt-4 w-full" onClick={onClose}>Enter the code instead</Button>
        </div>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-[18px] shadow-2xl">
            <video ref={videoRef} playsInline muted className="block h-[340px] w-[340px] object-cover" />
            {/* Framing reticle */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-8 rounded-[14px] border-2 border-white/80" />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-2 text-[13px] text-white/90">
            <Camera size={15} /> Point the camera at the sender's QR code
          </div>
        </>
      )}
    </div>
  );
}
