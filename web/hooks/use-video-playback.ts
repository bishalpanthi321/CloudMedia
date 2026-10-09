import { ChangeEvent, SyntheticEvent, useRef, useState } from "react";

export function useVideoPlayback() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  async function togglePlayback() {
    if (!videoRef.current) {
      return;
    }

    if (videoRef.current.paused) {
      try {
        await videoRef.current.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
      return;
    }

    videoRef.current.pause();
    setIsPlaying(false);
  }

  function seek(event: ChangeEvent<HTMLInputElement>) {
    const nextSeconds = Number(event.target.value);
    setCurrentSeconds(nextSeconds);

    if (!videoRef.current) {
      return;
    }

    videoRef.current.currentTime = nextSeconds;
  }

  function onLoadedMetadata(event: SyntheticEvent<HTMLVideoElement>) {
    setDurationSeconds(event.currentTarget.duration || 0);
    setCurrentSeconds(event.currentTarget.currentTime || 0);
    setIsPlaying(false);
  }

  function onTimeUpdate(event: SyntheticEvent<HTMLVideoElement>) {
    setCurrentSeconds(event.currentTarget.currentTime || 0);
  }

  function onPlay() {
    setIsPlaying(true);
  }

  function onPause() {
    if (!videoRef.current) {
      setIsPlaying(false);
      return;
    }

    if (videoRef.current.currentTime >= videoRef.current.duration) {
      return;
    }

    setIsPlaying(false);
  }

  function onEnded() {
    setIsPlaying(false);
  }

  function reset() {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }

    setDurationSeconds(0);
    setCurrentSeconds(0);
    setIsPlaying(false);
  }

  return {
    videoRef,
    durationSeconds,
    currentSeconds,
    isPlaying,
    togglePlayback,
    seek,
    onLoadedMetadata,
    onTimeUpdate,
    onPlay,
    onPause,
    onEnded,
    reset,
  };
}