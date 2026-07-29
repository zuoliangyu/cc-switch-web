import { useManagedAuth } from "./useManagedAuth";

export function useXaiOauth() {
  return useManagedAuth("xai_oauth");
}
