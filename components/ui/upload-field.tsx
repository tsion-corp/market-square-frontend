"use client";

import { cn } from "@/lib/cn";
import { useImageUpload } from "@/components/ui/use-image-upload";
import { IconCamera, IconX } from "@/components/ui/icons";

// Image upload field for avatars and covers: pick → local preview → eager
// upload with progress → onChange(url). Circular mode center-crops the
// preview (object-cover on a round frame).
export function UploadField({
  value,
  onChange,
  circular = false,
  label,
  className,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  circular?: boolean;
  label: string;
  className?: string;
}) {
  /* The behaviour lives in a hook so the profile editor can reuse it behind
     its own camera buttons without a second copy. */
  const upload = useImageUpload(value, onChange);
  const { shown, progress, error } = upload;

  return (
    <div className={className}>
      <span className="mb-1.5 block text-xs font-semibold text-grey-400">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={upload.open}
          aria-label={`Upload ${label}`}
          className={cn(
            "ws-press relative flex items-center justify-center overflow-hidden border border-white/15 bg-black/40 text-grey-500 transition-colors hover:border-white/30",
            circular ? "h-20 w-20 rounded-full" : "h-24 w-40 rounded-xl"
          )}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- freshly uploaded/object URLs
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <IconCamera className="h-6 w-6" />
          )}
          {progress !== null && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
              <span
                className="block h-full bg-accent transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </span>
          )}
        </button>
        {shown && progress === null && (
          <button
            type="button"
            onClick={upload.clear}
            aria-label={`Remove ${label}`}
            className="rounded-full p-1.5 text-grey-500 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconX className="h-4 w-4" />
          </button>
        )}
        {progress !== null && (
          <span className="tnum text-xs text-grey-500">{Math.round(progress * 100)}%</span>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-down">{error}</p>}
      <input {...upload.inputProps} />
    </div>
  );
}
