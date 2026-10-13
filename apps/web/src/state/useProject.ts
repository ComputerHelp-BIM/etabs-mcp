import { useCallback, useEffect, useState } from "react";
import { loadProject, saveProject, type Project } from "./projectStore";

/** Project data for one model, persisted to browser storage on every change. */
export function useProject(model: string): [Project, (update: (p: Project) => Project) => void, (p: Project) => void] {
  const [project, setProject] = useState<Project>(() => loadProject(model));

  useEffect(() => {
    setProject(loadProject(model));
  }, [model]);

  const update = useCallback((fn: (p: Project) => Project) => {
    setProject((prev) => {
      const next = fn(prev);
      saveProject(next);
      return next;
    });
  }, []);

  /** Replaces the whole project (import), keeping it bound to the current model. */
  const replace = useCallback(
    (p: Project) => {
      const next = { ...p, model };
      saveProject(next);
      setProject(next);
    },
    [model],
  );

  return [project, update, replace];
}
