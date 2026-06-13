"use client";

import { createContext, useContext } from "react";

export interface ProjectInfo {
  id: string;
  name: string;
  slug?: string | null;
  cost_center_code?: string | null;
}

const ProjectContext = createContext<ProjectInfo | null>(null);

export function ProjectProvider({ project, children }: { project: ProjectInfo; children: React.ReactNode }) {
  return <ProjectContext.Provider value={project}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectInfo {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}

export function useProjectOptional(): ProjectInfo | null {
  return useContext(ProjectContext);
}
