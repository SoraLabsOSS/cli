import { spinner as clackSpinner } from "@clack/prompts";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_DELAY_MS = 80;

/**
 * Shared spinner styling for every long-running fetch/resolve step —
 * braille frames plus an elapsed-time suffix (indicator: "timer") so a
 * slow network reads as "still working, N seconds in" rather than a bare
 * spin with no sense of progress.
 */
export function spinner() {
  return clackSpinner({
    delay: FRAME_DELAY_MS,
    frames: BRAILLE_FRAMES,
    indicator: "timer",
  });
}
