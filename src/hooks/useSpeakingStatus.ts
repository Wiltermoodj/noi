import { useEffect, useState } from "react";
import { audioService, IDLE_SPEAKING_STATUS, type SpeakingStatus } from "../services/audioService";

export function useSpeakingStatus(): SpeakingStatus {
  const [status, setStatus] = useState<SpeakingStatus>(IDLE_SPEAKING_STATUS);

  useEffect(() => {
    return audioService.subscribe(setStatus);
  }, []);

  return status;
}
