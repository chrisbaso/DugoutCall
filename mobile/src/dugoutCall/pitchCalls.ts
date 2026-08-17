export type PitchCall = {
  type: "pitch_call";
  id: string;
  pitch: string;
  location?: string;
  spokenText: string;
  timestamp: number;
};

export const createPitchCall = (
  pitch: string,
  location: string | undefined,
  id: () => string,
  now = Date.now
): PitchCall => {
  if (!pitch) throw new Error("Select a pitch first.");
  if (!location && pitch !== "Pickoff" && pitch !== "Pitchout") throw new Error("Select a location.");
  return {
    type: "pitch_call",
    id: id(),
    pitch,
    location,
    spokenText: [pitch, location].filter(Boolean).join(" "),
    timestamp: now()
  };
};
