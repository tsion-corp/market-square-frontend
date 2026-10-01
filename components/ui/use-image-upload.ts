"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api/envelope";
import { ACCEPT_IMAGE, ensureUploadLimits, uploadFile, validateUpload } from "@/lib/api/upload";

/*
  PICKING AN IMAGE, WITHOUT DECIDING WHAT THE CONTROL LOOKS LIKE.

  This was the body of `UploadField`, which also draws a labelled tile. The
  profile editor needs the same behaviour — limits, local preview, progress,
  errors — behind a camera button sitting on a cover photograph, so the two
  would otherwise be the same twenty lines written twice and corrected once.

  The hook owns the behaviour; the caller owns the button.
*/

export interface ImageUpload {
  /** The picture to show: a local preview while uploading, else the stored one. */
  shown: string | null;
  /** 0..1 while uploading, null when idle. */
  progress: number | null;
  error: string | null;
  /** Open the file picker. */
  open: () => void;
  /** Spread onto a hidden `<input type="file">`. */
  inputProps: {
    ref: React.RefObject<HTMLInputElement | null>;
    type: "file";
    accept: string;
    className: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  };
  clear: () => void;
}

export function useImageUpload(
  value: string | null,
  onChange: (url: string | null) => void,
): ImageUpload {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const pick = async (file: File) => {
    setError(null);
    // Limits come from the backend (GET /uploads/limits), memoised per
    // session, with the compiled-in fallback if it fails. Still checked before
    // the upload starts, so the error is instant and names both the cap and
    // this file's size.
    await ensureUploadLimits();
    const invalid = validateUpload(file, "image");
    if (invalid) {
      setError(invalid);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setProgress(0);
    try {
      const result = await uploadFile(file, setProgress, "image");
      onChange(result.url);
    } catch (uploadError) {
      setError(errorMessage(uploadError, "Upload failed."));
      setPreview(null);
      onChange(value);
    } finally {
      setProgress(null);
    }
  };

  return {
    shown: preview ?? value,
    progress,
    error,
    open: () => inputRef.current?.click(),
    clear: () => {
      setPreview(null);
      onChange(null);
    },
    inputProps: {
      ref: inputRef,
      type: "file",
      accept: ACCEPT_IMAGE,
      className: "hidden",
      onChange: (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void pick(file);
      },
    },
  };
}
